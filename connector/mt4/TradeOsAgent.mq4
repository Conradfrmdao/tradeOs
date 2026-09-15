//+------------------------------------------------------------------+
//|                                               TradeOsAgent.mq4   |
//|                        TradeOS terminal agent for MetaTrader 4   |
//+------------------------------------------------------------------+
//| Speaks the same protocol as the MT5 agent; only the terminal API  |
//| differs. See TradeOsAgent.mq5 for the full description.           |
//|                                                                   |
//| SETUP                                                             |
//|  1. Tools > Options > Expert Advisors                             |
//|     - tick "Allow WebRequest for listed URL"                      |
//|     - add your TradeOS API URL                                    |
//|  2. Enable "AutoTrading" in the toolbar.                          |
//|  3. Copy JsonLite.mqh into MQL4/Include/TradeOS/                  |
//|  4. Attach to a chart and paste the pairing code.                 |
//|                                                                   |
//| MT4 has no position concept: every order stands alone, so an      |
//| order ticket is what TradeOS records as the trade ticket.         |
//+------------------------------------------------------------------+
#property copyright "TradeOS"
#property version   "1.00"
#property strict
#property description "Connects this MetaTrader 4 account to TradeOS."

#include <TradeOS/JsonLite.mqh>

//--- input parameters -------------------------------------------------------
input string   ApiUrl         = "https://tradeos-one-bice.vercel.app/api"; // TradeOS API URL
input string   PairingCode    = "";                      // Pairing code (first run only)
input int      PollSeconds    = 3;                       // Seconds between syncs
input int      SlippagePoints = 20;                      // Max slippage (points)
input bool     VerboseLog     = false;                   // Log every sync

//--- constants --------------------------------------------------------------
#define AGENT_VERSION      "1.0.0"
#define PROTOCOL_VERSION   1
#define HTTP_TIMEOUT_MS    8000
#define MAX_TRACKED_TASKS  256
#define ORDER_RETRIES      2

//--- state ------------------------------------------------------------------
string   g_token        = "";
string   g_tokenFile    = "";
string   g_historyFrom  = "";
bool     g_paired       = false;
bool     g_warnedWebReq = false;

//--- results waiting to be reported to the server
string   g_resTaskId[];
string   g_resStatus[];
string   g_resTicket[];
int      g_resRetcode[];
string   g_resMessage[];
double   g_resPrice[];

//--- task ids already executed (agent-side duplicate guard)
string   g_doneTasks[];

//--- symbols the server asked us to report volume limits for
string   g_watchSymbols[];

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
int OnInit(void)
{
   g_tokenFile = StringFormat("TradeOS_%d.token", AccountNumber());
   g_token     = LoadToken();

   if(g_token == "")
   {
      if(StringLen(PairingCode) == 0)
      {
         Print("TradeOS: no saved token and no pairing code. ",
               "Create the account in the TradeOS dashboard, then paste its pairing code ",
               "into this EA's inputs.");
         return INIT_FAILED;
      }

      if(!Pair())
         return INIT_FAILED;
   }
   else
   {
      g_paired = true;
      Print("TradeOS: resuming with saved token for account ", AccountNumber());
   }

   const int seconds = (PollSeconds < 1) ? 1 : PollSeconds;
   EventSetTimer(seconds);

   Sync();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();

   if(g_paired && reason == REASON_REMOVE)
      Unpair();

   Print("TradeOS: agent stopped (reason ", reason, ")");
}

void OnTimer(void)
{
   Sync();
}

//+------------------------------------------------------------------+
//| Pairing                                                          |
//+------------------------------------------------------------------+
bool Pair(void)
{
   string parts[];
   ArrayResize(parts, 8);
   parts[0] = JsonStr("pairingCode",   PairingCode);
   parts[1] = JsonStr("platform",      "MT4");
   parts[2] = JsonStr("accountNumber", IntegerToString(AccountNumber()));
   parts[3] = JsonStr("server",        AccountServer());
   parts[4] = JsonStr("broker",        AccountCompany());
   parts[5] = JsonStr("currency",      AccountCurrency());
   parts[6] = JsonRaw("leverage",      IntegerToString(AccountLeverage()));
   parts[7] = JsonStr("agentVersion",  AGENT_VERSION);

   string response = "";
   const int status = HttpPost("/agent/v1/pair", JsonObject(parts), "", response);

   if(status != 200)
   {
      Print("TradeOS: pairing failed (HTTP ", status, "): ", ExtractError(response));
      return false;
   }

   JsonParser parser;
   JsonNode *root = parser.Parse(response);
   if(root == NULL)
   {
      Print("TradeOS: pairing response could not be parsed");
      return false;
   }

   g_token = root.GetStr("token");
   const string accountName = root.GetStr("accountName");
   const string role        = root.GetStr("role");
   delete root;

   if(g_token == "")
   {
      Print("TradeOS: pairing response contained no token");
      return false;
   }

   if(!SaveToken(g_token))
      Print("TradeOS: WARNING — token could not be saved; a new pairing code ",
            "will be needed if the terminal restarts");

   g_paired = true;
   Print("TradeOS: paired as \"", accountName, "\" (", role, ")");
   return true;
}

void Unpair(void)
{
   string response = "";
   HttpPost("/agent/v1/unpair", "{}", g_token, response);
   FileDelete(g_tokenFile);
}

//+------------------------------------------------------------------+
//| The sync loop                                                    |
//+------------------------------------------------------------------+
void Sync(void)
{
   if(!g_paired || g_token == "")
      return;

   string response = "";
   const int status = HttpPost("/agent/v1/sync", BuildSyncPayload(), g_token, response);

   if(status == 401)
   {
      Print("TradeOS: this agent was disconnected by the dashboard. ",
            "Re-pair it with a new code.");
      FileDelete(g_tokenFile);
      g_paired = false;
      EventKillTimer();
      return;
   }

   if(status != 200)
   {
      if(VerboseLog || status <= 0)
         Print("TradeOS: sync failed (HTTP ", status, ") ", ExtractError(response));
      return;
   }

   HandleSyncResponse(response);
}

string BuildSyncPayload(void)
{
   string parts[];
   ArrayResize(parts, 8);

   parts[0] = JsonRaw("protocolVersion", IntegerToString(PROTOCOL_VERSION));
   parts[1] = JsonStr("agentVersion",    AGENT_VERSION);
   parts[2] = JsonStr("terminalBuild",   IntegerToString(TerminalInfoInteger(TERMINAL_BUILD)));
   parts[3] = JsonRaw("account",         BuildAccountState());
   parts[4] = JsonRaw("positions",       BuildOpenOrders());
   parts[5] = JsonRaw("closed",          BuildClosedOrders());
   parts[6] = JsonRaw("results",         BuildResults());
   parts[7] = JsonRaw("symbolSpecs",     BuildSymbolSpecs());

   return JsonObject(parts);
}

string BuildAccountState(void)
{
   string parts[];
   ArrayResize(parts, 10);
   parts[0] = JsonNum("balance",     AccountBalance(), 2);
   parts[1] = JsonNum("equity",      AccountEquity(), 2);
   parts[2] = JsonNum("margin",      AccountMargin(), 2);
   parts[3] = JsonNum("freeMargin",  AccountFreeMargin(), 2);
   //--- MT4 reports margin level as a percentage only when margin is in use.
   parts[4] = JsonNum("marginLevel",
                      (AccountMargin() > 0.0) ? (AccountEquity() / AccountMargin() * 100.0) : 0.0, 2);
   parts[5] = JsonNum("credit",      AccountCredit(), 2);
   parts[6] = JsonStr("currency",    AccountCurrency());
   parts[7] = JsonRaw("leverage",    IntegerToString(AccountLeverage()));
   parts[8] = JsonBool("tradeAllowed", IsTradeAllowed());
   parts[9] = JsonStr("serverTime",  IsoUtc(TimeCurrent()));

   return JsonObject(parts);
}

//--- Full snapshot of open market orders (MT4 has no position aggregation).
string BuildOpenOrders(void)
{
   string out = "[";
   int written = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      const int type = OrderType();
      //--- Market orders only; pending orders are not copied in V1.
      if(type != OP_BUY && type != OP_SELL)
         continue;

      const string symbol = OrderSymbol();
      const int digits = (int)MarketInfo(symbol, MODE_DIGITS);

      string parts[];
      ArrayResize(parts, 14);
      parts[0]  = JsonStr("ticket",       IntegerToString(OrderTicket()));
      parts[1]  = JsonStr("positionId",   IntegerToString(OrderTicket()));
      parts[2]  = JsonStr("magic",        IntegerToString(OrderMagicNumber()));
      parts[3]  = JsonStr("symbol",       symbol);
      parts[4]  = JsonStr("direction",    (type == OP_BUY) ? "BUY" : "SELL");
      parts[5]  = JsonNum("volume",       OrderLots(), 2);
      parts[6]  = JsonNum("openPrice",    OrderOpenPrice(), digits);
      parts[7]  = JsonNum("currentPrice", OrderClosePrice(), digits);
      parts[8]  = JsonNum("stopLoss",     OrderStopLoss(), digits);
      parts[9]  = JsonNum("takeProfit",   OrderTakeProfit(), digits);
      parts[10] = JsonNum("profit",       OrderProfit(), 2);
      parts[11] = JsonNum("swap",         OrderSwap(), 2);
      parts[12] = JsonStr("openTime",     IsoUtc(OrderOpenTime()));
      parts[13] = JsonStr("comment",      OrderComment());

      if(written > 0)
         out += ",";
      out += JsonObject(parts);
      written++;
   }

   return out + "]";
}

string BuildClosedOrders(void)
{
   datetime from = (g_historyFrom == "") ? (TimeCurrent() - 3600) : ParseIsoUtcToServer(g_historyFrom);
   if(from <= 0)
      from = TimeCurrent() - 3600;

   string out = "[";
   int written = 0;

   const int total = OrdersHistoryTotal();
   for(int i = total - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;

      const int type = OrderType();
      //--- Skip deposits, withdrawals and credit entries.
      if(type != OP_BUY && type != OP_SELL)
         continue;

      if(OrderCloseTime() <= 0 || OrderCloseTime() < from)
         continue;

      const string symbol = OrderSymbol();
      const int digits = (int)MarketInfo(symbol, MODE_DIGITS);

      string parts[];
      ArrayResize(parts, 14);
      parts[0]  = JsonStr("ticket",     IntegerToString(OrderTicket()));
      parts[1]  = JsonStr("positionId", IntegerToString(OrderTicket()));
      parts[2]  = JsonStr("magic",      IntegerToString(OrderMagicNumber()));
      parts[3]  = JsonStr("symbol",     symbol);
      parts[4]  = JsonStr("direction",  (type == OP_BUY) ? "BUY" : "SELL");
      parts[5]  = JsonNum("volume",     OrderLots(), 2);
      parts[6]  = JsonNum("openPrice",  OrderOpenPrice(), digits);
      parts[7]  = JsonNum("closePrice", OrderClosePrice(), digits);
      parts[8]  = JsonNum("stopLoss",   OrderStopLoss(), digits);
      parts[9]  = JsonNum("takeProfit", OrderTakeProfit(), digits);
      parts[10] = JsonNum("profit",     OrderProfit(), 2);
      parts[11] = JsonNum("swap",       OrderSwap(), 2);
      parts[12] = JsonNum("commission", OrderCommission(), 2);
      parts[13] = JsonStr("openTime",   IsoUtc(OrderOpenTime()));

      //--- closeTime is appended separately to keep the array size fixed above
      string record = JsonObject(parts);
      record = StringSubstr(record, 0, StringLen(record) - 1) + "," +
               JsonStr("closeTime", IsoUtc(OrderCloseTime())) + "}";

      if(written > 0)
         out += ",";
      out += record;
      written++;

      if(written >= 200)
         break;
   }

   return out + "]";
}

string BuildResults(void)
{
   string out = "[";
   for(int i = 0; i < ArraySize(g_resTaskId); i++)
   {
      string parts[];
      ArrayResize(parts, 6);
      parts[0] = JsonStr("taskId",  g_resTaskId[i]);
      parts[1] = JsonStr("status",  g_resStatus[i]);
      parts[2] = JsonStr("ticket",  g_resTicket[i]);
      parts[3] = JsonRaw("retcode", IntegerToString(g_resRetcode[i]));
      parts[4] = JsonStr("message", g_resMessage[i]);
      parts[5] = JsonNum("executedPrice", g_resPrice[i], 8);

      if(i > 0)
         out += ",";
      out += JsonObject(parts);
   }
   return out + "]";
}

string BuildSymbolSpecs(void)
{
   string out = "[";
   int written = 0;

   for(int i = 0; i < ArraySize(g_watchSymbols); i++)
   {
      const string symbol = g_watchSymbols[i];
      if(StringLen(symbol) == 0)
         continue;

      const double minLot = MarketInfo(symbol, MODE_MINLOT);

      //--- An unknown symbol reports zero for everything; say so explicitly
      //--- rather than sending zeros the server would have to guess about.
      if(minLot <= 0.0)
      {
         string missing[];
         ArrayResize(missing, 2);
         missing[0] = JsonStr("symbol", symbol);
         missing[1] = JsonBool("tradable", false);

         if(written > 0) out += ",";
         out += JsonObject(missing);
         written++;
         continue;
      }

      string parts[];
      ArrayResize(parts, 7);
      parts[0] = JsonStr("symbol",     symbol);
      parts[1] = JsonNum("volumeMin",  minLot, 4);
      parts[2] = JsonNum("volumeMax",  MarketInfo(symbol, MODE_MAXLOT), 4);
      parts[3] = JsonNum("volumeStep", MarketInfo(symbol, MODE_LOTSTEP), 4);
      parts[4] = JsonRaw("digits",     IntegerToString((int)MarketInfo(symbol, MODE_DIGITS)));
      parts[5] = JsonNum("point",      MarketInfo(symbol, MODE_POINT), 8);
      parts[6] = JsonBool("tradable",  true);

      if(written > 0) out += ",";
      out += JsonObject(parts);
      written++;
   }

   return out + "]";
}

//+------------------------------------------------------------------+
//| Response handling                                                |
//+------------------------------------------------------------------+
void HandleSyncResponse(const string response)
{
   JsonParser parser;
   JsonNode *root = parser.Parse(response);
   if(root == NULL)
   {
      Print("TradeOS: could not parse sync response");
      return;
   }

   g_historyFrom = root.GetStr("historyFrom", g_historyFrom);

   JsonNode *ack = root.Find("acknowledged");
   if(ack != NULL)
      for(int a = 0; a < ack.Size(); a++)
      {
         JsonNode *item = ack.At(a);
         if(item != NULL)
            RemoveResult(item.str);
      }

   JsonNode *watch = root.Find("watchSymbols");
   if(watch != NULL)
   {
      ArrayResize(g_watchSymbols, watch.Size());
      for(int i = 0; i < watch.Size(); i++)
      {
         JsonNode *item = watch.At(i);
         g_watchSymbols[i] = (item != NULL) ? item.str : "";
      }
   }

   JsonNode *commands = root.Find("commands");
   if(commands != NULL)
      for(int i = 0; i < commands.Size(); i++)
         ExecuteCommand(commands.At(i));

   delete root;

   if(VerboseLog)
      Print("TradeOS: sync ok");
}

//+------------------------------------------------------------------+
//| Command execution                                                |
//+------------------------------------------------------------------+
void ExecuteCommand(JsonNode *command)
{
   if(command == NULL)
      return;

   const string taskId = command.GetStr("id");
   if(taskId == "")
      return;

   if(AlreadyExecuted(taskId))
   {
      Print("TradeOS: ignoring repeat of task ", taskId);
      return;
   }

   const string expiresAt = command.GetStr("expiresAt");
   if(expiresAt != "" && ParseIsoUtcToServer(expiresAt) < TimeCurrent())
   {
      RecordResult(taskId, "SKIPPED", "", 0, "Command expired before the terminal executed it", 0);
      MarkExecuted(taskId);
      return;
   }

   const string action = command.GetStr("action");

   if(action == "OPEN")
      ExecuteOpen(command, taskId);
   else if(action == "CLOSE")
      ExecuteClose(command, taskId);
   else if(action == "MODIFY")
      ExecuteModify(command, taskId);
   else
      RecordResult(taskId, "SKIPPED", "", 0, "Unsupported action: " + action, 0);

   MarkExecuted(taskId);
}

void ExecuteOpen(JsonNode *command, const string taskId)
{
   const string symbol  = command.GetStr("symbol");
   const string dir     = command.GetStr("direction");
   double volume        = command.GetNum("volume");
   const double sl      = command.GetNum("stopLoss");
   const double tp      = command.GetNum("takeProfit");
   const int    magic   = (int)command.GetNum("magic");
   const string comment = command.GetStr("comment");

   if(MarketInfo(symbol, MODE_MINLOT) <= 0.0)
   {
      RecordResult(taskId, "FAILED", "", 4106,
                   "Symbol " + symbol + " is not available on this broker", 0);
      return;
   }

   string adjustment = "";
   volume = NormalizeVolume(symbol, volume, adjustment);

   if(volume <= 0.0)
   {
      RecordResult(taskId, "FAILED", "", 131,
                   "Volume is below this broker's minimum for " + symbol, 0);
      return;
   }

   const int type   = (dir == "BUY") ? OP_BUY : OP_SELL;
   const int digits = (int)MarketInfo(symbol, MODE_DIGITS);
   const int slippage = (SlippagePoints > 0) ? SlippagePoints : 20;

   int ticket = -1;
   int lastError = 0;

   //--- A requote is the one failure worth retrying inside the terminal: the
   //--- round trip back to the server would cost more than the retry does.
   for(int attempt = 0; attempt <= ORDER_RETRIES; attempt++)
   {
      RefreshRates();
      const double price = (type == OP_BUY) ? MarketInfo(symbol, MODE_ASK)
                                            : MarketInfo(symbol, MODE_BID);

      ticket = OrderSend(symbol, type, volume, NormalizeDouble(price, digits), slippage,
                         NormalizeDouble(sl, digits), NormalizeDouble(tp, digits),
                         comment, magic, 0, clrNONE);

      if(ticket > 0)
         break;

      lastError = GetLastError();
      if(lastError != 135 && lastError != 138 && lastError != 136)
         break;

      Sleep(200);
   }

   if(ticket <= 0)
   {
      RecordResult(taskId, "FAILED", "", lastError, ErrorText(lastError), 0);
      Print("TradeOS: open failed on ", symbol, " — error ", lastError, " ", ErrorText(lastError));
      return;
   }

   string note = "Opened " + dir + " " + DoubleToString(volume, 2) + " " + symbol;
   if(adjustment != "")
      note += " (" + adjustment + ")";

   double filled = 0.0;
   if(OrderSelect(ticket, SELECT_BY_TICKET))
      filled = OrderOpenPrice();

   RecordResult(taskId, "SUCCESS", IntegerToString(ticket), 0, note, filled);
   Print("TradeOS: ", note, " ticket ", ticket);
}

void ExecuteClose(JsonNode *command, const string taskId)
{
   const string target = command.GetStr("targetTicket");
   const int ticket = (int)StringToInteger(target);

   if(ticket <= 0 || !OrderSelect(ticket, SELECT_BY_TICKET))
   {
      RecordResult(taskId, "SKIPPED", target, 0, "Order not found — already closed", 0);
      return;
   }

   if(OrderCloseTime() > 0)
   {
      RecordResult(taskId, "SKIPPED", target, 0, "Position is already closed", 0);
      return;
   }

   const string symbol = OrderSymbol();
   const int digits = (int)MarketInfo(symbol, MODE_DIGITS);
   const int slippage = (SlippagePoints > 0) ? SlippagePoints : 20;

   bool closed = false;
   int lastError = 0;

   for(int attempt = 0; attempt <= ORDER_RETRIES; attempt++)
   {
      RefreshRates();
      if(!OrderSelect(ticket, SELECT_BY_TICKET))
         break;

      const double price = (OrderType() == OP_BUY) ? MarketInfo(symbol, MODE_BID)
                                                   : MarketInfo(symbol, MODE_ASK);

      closed = OrderClose(ticket, OrderLots(), NormalizeDouble(price, digits), slippage, clrNONE);
      if(closed)
         break;

      lastError = GetLastError();
      if(lastError != 135 && lastError != 138 && lastError != 136)
         break;

      Sleep(200);
   }

   if(!closed)
   {
      RecordResult(taskId, "FAILED", target, lastError, ErrorText(lastError), 0);
      return;
   }

   RecordResult(taskId, "SUCCESS", target, 0, "Position closed", 0);
   Print("TradeOS: closed ticket ", target);
}

void ExecuteModify(JsonNode *command, const string taskId)
{
   const string target = command.GetStr("targetTicket");
   const int ticket = (int)StringToInteger(target);

   if(ticket <= 0 || !OrderSelect(ticket, SELECT_BY_TICKET) || OrderCloseTime() > 0)
   {
      RecordResult(taskId, "SKIPPED", target, 0, "Order no longer open", 0);
      return;
   }

   const int digits = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
   const double sl = NormalizeDouble(command.GetNum("stopLoss"), digits);
   const double tp = NormalizeDouble(command.GetNum("takeProfit"), digits);

   //--- MT4 rejects a modify that changes nothing; treat that as done.
   if(MathAbs(OrderStopLoss() - sl) < Point / 2 && MathAbs(OrderTakeProfit() - tp) < Point / 2)
   {
      RecordResult(taskId, "SUCCESS", target, 0, "Stops already match", 0);
      return;
   }

   if(!OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrNONE))
   {
      const int error = GetLastError();
      RecordResult(taskId, "FAILED", target, error, ErrorText(error), 0);
      return;
   }

   RecordResult(taskId, "SUCCESS", target, 0, "Stops updated", 0);
}

double NormalizeVolume(const string symbol, const double requested, string &note)
{
   const double minLot = MarketInfo(symbol, MODE_MINLOT);
   const double maxLot = MarketInfo(symbol, MODE_MAXLOT);
   const double step   = MarketInfo(symbol, MODE_LOTSTEP);

   double volume = requested;

   if(maxLot > 0 && volume > maxLot)
   {
      volume = maxLot;
      note = StringFormat("capped at broker maximum %s", DoubleToString(maxLot, 2));
   }

   if(step > 0)
      volume = MathFloor(volume / step + 0.5) * step;

   if(minLot > 0 && volume < minLot)
   {
      if(requested >= minLot * 0.9)
      {
         volume = minLot;
         note = StringFormat("raised to broker minimum %s", DoubleToString(minLot, 2));
      }
      else
         return 0.0;
   }

   return NormalizeDouble(volume, 2);
}

string ErrorText(const int code)
{
   switch(code)
   {
      case 4:   return "Trade server is busy";
      case 6:   return "No connection to the trade server";
      case 64:  return "Account is disabled";
      case 128: return "Trade timed out";
      case 129: return "Invalid price";
      case 130: return "Invalid stop loss or take profit";
      case 131: return "Invalid trade volume";
      case 132: return "Market is closed";
      case 133: return "Trading is disabled";
      case 134: return "Not enough money";
      case 135: return "Price changed";
      case 136: return "Off quotes";
      case 138: return "Requote";
      case 146: return "Trade context is busy";
      case 148: return "Too many open orders";
      case 4106: return "Unknown symbol";
      case 4109: return "Trading is not allowed for this EA";
      default:  return StringFormat("Broker error %d", code);
   }
}

//+------------------------------------------------------------------+
//| Result bookkeeping                                               |
//+------------------------------------------------------------------+
void RecordResult(const string taskId, const string status, const string ticket,
                  const int retcode, const string message, const double price)
{
   const int n = ArraySize(g_resTaskId);
   ArrayResize(g_resTaskId,  n + 1);
   ArrayResize(g_resStatus,  n + 1);
   ArrayResize(g_resTicket,  n + 1);
   ArrayResize(g_resRetcode, n + 1);
   ArrayResize(g_resMessage, n + 1);
   ArrayResize(g_resPrice,   n + 1);

   g_resTaskId[n]  = taskId;
   g_resStatus[n]  = status;
   g_resTicket[n]  = ticket;
   g_resRetcode[n] = retcode;
   g_resMessage[n] = message;
   g_resPrice[n]   = price;
}

void RemoveResult(const string taskId)
{
   const int total = ArraySize(g_resTaskId);
   for(int i = 0; i < total; i++)
   {
      if(g_resTaskId[i] != taskId)
         continue;

      for(int j = i; j < total - 1; j++)
      {
         g_resTaskId[j]  = g_resTaskId[j + 1];
         g_resStatus[j]  = g_resStatus[j + 1];
         g_resTicket[j]  = g_resTicket[j + 1];
         g_resRetcode[j] = g_resRetcode[j + 1];
         g_resMessage[j] = g_resMessage[j + 1];
         g_resPrice[j]   = g_resPrice[j + 1];
      }

      ArrayResize(g_resTaskId,  total - 1);
      ArrayResize(g_resStatus,  total - 1);
      ArrayResize(g_resTicket,  total - 1);
      ArrayResize(g_resRetcode, total - 1);
      ArrayResize(g_resMessage, total - 1);
      ArrayResize(g_resPrice,   total - 1);
      return;
   }
}

bool AlreadyExecuted(const string taskId)
{
   for(int i = 0; i < ArraySize(g_doneTasks); i++)
      if(g_doneTasks[i] == taskId)
         return true;
   return false;
}

void MarkExecuted(const string taskId)
{
   const int n = ArraySize(g_doneTasks);

   if(n >= MAX_TRACKED_TASKS)
   {
      for(int i = 0; i < n - 1; i++)
         g_doneTasks[i] = g_doneTasks[i + 1];
      g_doneTasks[n - 1] = taskId;
      return;
   }

   ArrayResize(g_doneTasks, n + 1);
   g_doneTasks[n] = taskId;
}

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
int HttpPost(const string path, const string body, const string bearer, string &response)
{
   string headers = "Content-Type: application/json\r\n";
   if(bearer != "")
      headers += "Authorization: Bearer " + bearer + "\r\n";

   char post[];
   char result[];
   string resultHeaders = "";

   const int len = StringToCharArray(body, post, 0, StringLen(body), CP_UTF8) - 1;
   if(len > 0)
      ArrayResize(post, len);

   ResetLastError();
   const int status = WebRequest("POST", ApiUrl + path, headers, HTTP_TIMEOUT_MS,
                                 post, result, resultHeaders);

   if(status == -1)
   {
      const int error = GetLastError();
      //--- 4060 in MT4, 4014 in MT5 — both mean "URL not whitelisted".
      if((error == 4060 || error == 4014) && !g_warnedWebReq)
      {
         g_warnedWebReq = true;
         Print("TradeOS: WebRequest is not permitted for ", ApiUrl,
               ". Add it under Tools > Options > Expert Advisors > ",
               "\"Allow WebRequest for listed URL\".");
      }
      else if(error != 4060 && error != 4014)
      {
         Print("TradeOS: WebRequest failed, error ", error);
      }
      response = "";
      return -1;
   }

   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return status;
}

string ExtractError(const string response)
{
   if(StringLen(response) == 0)
      return "(no response)";

   JsonParser parser;
   JsonNode *root = parser.Parse(response);
   if(root == NULL)
      return response;

   JsonNode *err = root.Find("error");
   string message = (err != NULL) ? err.GetStr("message", response) : response;
   delete root;
   return message;
}

//+------------------------------------------------------------------+
//| Token storage                                                    |
//+------------------------------------------------------------------+
bool SaveToken(const string token)
{
   const int handle = FileOpen(g_tokenFile, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return false;

   FileWriteString(handle, token);
   FileClose(handle);
   return true;
}

string LoadToken(void)
{
   if(!FileIsExist(g_tokenFile))
      return "";

   const int handle = FileOpen(g_tokenFile, FILE_READ | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return "";

   const string token = FileReadString(handle);
   FileClose(handle);
   return token;
}

//+------------------------------------------------------------------+
//| Time                                                             |
//+------------------------------------------------------------------+
string IsoUtc(const datetime serverTime)
{
   const int offset = (int)(TimeGMT() - TimeCurrent());
   const datetime utc = serverTime + offset;

   MqlDateTime dt;
   TimeToStruct(utc, dt);

   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
}

datetime ParseIsoUtcToServer(const string iso)
{
   if(StringLen(iso) < 19)
      return 0;

   MqlDateTime dt;
   dt.year = (int)StringToInteger(StringSubstr(iso, 0, 4));
   dt.mon  = (int)StringToInteger(StringSubstr(iso, 5, 2));
   dt.day  = (int)StringToInteger(StringSubstr(iso, 8, 2));
   dt.hour = (int)StringToInteger(StringSubstr(iso, 11, 2));
   dt.min  = (int)StringToInteger(StringSubstr(iso, 14, 2));
   dt.sec  = (int)StringToInteger(StringSubstr(iso, 17, 2));

   const datetime utc = StructToTime(dt);
   const int offset = (int)(TimeGMT() - TimeCurrent());
   return utc - offset;
}
//+------------------------------------------------------------------+
