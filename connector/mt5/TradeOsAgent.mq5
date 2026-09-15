//+------------------------------------------------------------------+
//|                                               TradeOsAgent.mq5   |
//|                        TradeOS terminal agent for MetaTrader 5   |
//+------------------------------------------------------------------+
//| WHAT THIS IS                                                      |
//|                                                                   |
//| The bridge between one MetaTrader 5 account and TradeOS. Attach   |
//| it to any chart on the account you want to connect.               |
//|                                                                   |
//| It never receives your trading password, and TradeOS never stores |
//| one: the terminal is already logged in, and this agent simply     |
//| reports what it sees and executes the instructions it is given.   |
//|                                                                   |
//| SETUP                                                             |
//|  1. Tools > Options > Expert Advisors                             |
//|     - tick "Allow WebRequest for listed URL"                      |
//|     - add your TradeOS API URL (e.g. https://api.tradeos.app)     |
//|  2. Tick "Allow Algo Trading" in the toolbar.                     |
//|  3. Copy JsonLite.mqh into MQL5/Include/TradeOS/                  |
//|  4. Attach this EA to a chart, paste the pairing code from the    |
//|     dashboard, and press OK.                                      |
//|                                                                   |
//| The pairing code is single-use and expires; after pairing, the    |
//| agent stores a token in MQL5/Files and reconnects on its own.     |
//+------------------------------------------------------------------+
#property copyright "TradeOS"
#property version   "1.00"
#property strict
#property description "Connects this MetaTrader 5 account to TradeOS."

#include <Trade/Trade.mqh>
#include <TradeOS/JsonLite.mqh>

//--- input parameters -------------------------------------------------------
input string   ApiUrl        = "https://tradeos-one-bice.vercel.app/api"; // TradeOS API URL
input string   PairingCode   = "";                      // Pairing code (first run only)
input int      PollSeconds   = 3;                       // Seconds between syncs
input int      SlippagePoints= 20;                      // Max slippage (points)
input bool     VerboseLog    = false;                   // Log every sync

//--- constants --------------------------------------------------------------
#define AGENT_VERSION      "1.0.0"
#define PROTOCOL_VERSION   1
#define HTTP_TIMEOUT_MS    8000
#define MAX_TRACKED_TASKS  256

//--- state ------------------------------------------------------------------
string   g_token        = "";
string   g_tokenFile    = "";
string   g_historyFrom  = "";
bool     g_paired       = false;
bool     g_warnedWebReq = false;
datetime g_lastSync     = 0;

//--- results waiting to be reported to the server
string   g_resTaskId[];
string   g_resStatus[];
string   g_resTicket[];
int      g_resRetcode[];
string   g_resMessage[];
double   g_resPrice[];
double   g_resVolume[];

//--- task ids already executed, so a re-delivered command is never
//--- executed twice even if the server repeats it (PRD 42, agent side)
string   g_doneTasks[];

//--- symbols the server asked us to report volume limits for
string   g_watchSymbols[];

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
int OnInit(void)
{
   g_tokenFile = StringFormat("TradeOS_%I64d.token", AccountInfoInteger(ACCOUNT_LOGIN));
   g_token     = LoadToken();

   if(g_token == "")
   {
      if(StringLen(PairingCode) == 0)
      {
         Print("TradeOS: no saved token and no pairing code. ",
               "Create the account in the TradeOS dashboard, then paste its pairing code into ",
               "this EA's inputs.");
         return INIT_FAILED;
      }

      if(!Pair())
         return INIT_FAILED;
   }
   else
   {
      g_paired = true;
      Print("TradeOS: resuming with saved token for account ",
            AccountInfoInteger(ACCOUNT_LOGIN));
   }

   const int seconds = (PollSeconds < 1) ? 1 : PollSeconds;
   EventSetTimer(seconds);

   //--- Sync immediately so the dashboard lights up without waiting a tick.
   Sync();

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();

   //--- A removed EA means this account is going offline. Telling the server
   //--- turns it into a clean "disconnected" instead of a heartbeat timeout.
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
   parts[1] = JsonStr("platform",      "MT5");
   parts[2] = JsonStr("accountNumber", IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
   parts[3] = JsonStr("server",        AccountInfoString(ACCOUNT_SERVER));
   parts[4] = JsonStr("broker",        AccountInfoString(ACCOUNT_COMPANY));
   parts[5] = JsonStr("currency",      AccountInfoString(ACCOUNT_CURRENCY));
   parts[6] = JsonRaw("leverage",      IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)));
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
      Print("TradeOS: WARNING — token could not be saved; the agent will need ",
            "a new pairing code if the terminal restarts");

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

   const string payload = BuildSyncPayload();

   string response = "";
   const int status = HttpPost("/agent/v1/sync", payload, g_token, response);

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
      //--- Network blips are expected; keep polling rather than giving up.
      if(VerboseLog || status <= 0)
         Print("TradeOS: sync failed (HTTP ", status, ") ", ExtractError(response));
      return;
   }

   HandleSyncResponse(response);
   g_lastSync = TimeCurrent();
}

string BuildSyncPayload(void)
{
   string parts[];
   ArrayResize(parts, 8);

   parts[0] = JsonRaw("protocolVersion", IntegerToString(PROTOCOL_VERSION));
   parts[1] = JsonStr("agentVersion",    AGENT_VERSION);
   parts[2] = JsonStr("terminalBuild",   IntegerToString(TerminalInfoInteger(TERMINAL_BUILD)));
   parts[3] = JsonRaw("account",         BuildAccountState());
   parts[4] = JsonRaw("positions",       BuildOpenPositions());
   parts[5] = JsonRaw("closed",          BuildClosedDeals());
   parts[6] = JsonRaw("results",         BuildResults());
   parts[7] = JsonRaw("symbolSpecs",     BuildSymbolSpecs());

   return JsonObject(parts);
}

string BuildAccountState(void)
{
   const double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   const double equity  = AccountInfoDouble(ACCOUNT_EQUITY);

   string parts[];
   ArrayResize(parts, 10);
   parts[0] = JsonNum("balance",     balance, 2);
   parts[1] = JsonNum("equity",      equity, 2);
   parts[2] = JsonNum("margin",      AccountInfoDouble(ACCOUNT_MARGIN), 2);
   parts[3] = JsonNum("freeMargin",  AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2);
   parts[4] = JsonNum("marginLevel", AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2);
   parts[5] = JsonNum("credit",      AccountInfoDouble(ACCOUNT_CREDIT), 2);
   parts[6] = JsonStr("currency",    AccountInfoString(ACCOUNT_CURRENCY));
   parts[7] = JsonRaw("leverage",    IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)));
   //--- Reported so the dashboard can explain why copies would fail, rather
   //--- than letting every order bounce with an opaque broker error.
   parts[8] = JsonBool("tradeAllowed",
                       (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) &&
                       (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
                       MQLInfoInteger(MQL_TRADE_ALLOWED));
   parts[9] = JsonStr("serverTime",  IsoUtc(TimeCurrent()));

   return JsonObject(parts);
}

//--- Full snapshot of open positions. The server diffs it, so sending the
//--- whole list every time is what makes a missed poll harmless.
string BuildOpenPositions(void)
{
   string out = "[";
   int written = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      const ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      const string symbol = PositionGetString(POSITION_SYMBOL);
      const int    digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

      string parts[];
      ArrayResize(parts, 14);
      parts[0]  = JsonStr("ticket",      IntegerToString((long)ticket));
      parts[1]  = JsonStr("positionId",  IntegerToString((long)PositionGetInteger(POSITION_IDENTIFIER)));
      parts[2]  = JsonStr("magic",       IntegerToString((long)PositionGetInteger(POSITION_MAGIC)));
      parts[3]  = JsonStr("symbol",      symbol);
      parts[4]  = JsonStr("direction",
                          (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL");
      parts[5]  = JsonNum("volume",      PositionGetDouble(POSITION_VOLUME), 2);
      parts[6]  = JsonNum("openPrice",   PositionGetDouble(POSITION_PRICE_OPEN), digits);
      parts[7]  = JsonNum("currentPrice",PositionGetDouble(POSITION_PRICE_CURRENT), digits);
      parts[8]  = JsonNum("stopLoss",    PositionGetDouble(POSITION_SL), digits);
      parts[9]  = JsonNum("takeProfit",  PositionGetDouble(POSITION_TP), digits);
      parts[10] = JsonNum("profit",      PositionGetDouble(POSITION_PROFIT), 2);
      parts[11] = JsonNum("swap",        PositionGetDouble(POSITION_SWAP), 2);
      parts[12] = JsonStr("openTime",    IsoUtc((datetime)PositionGetInteger(POSITION_TIME)));
      parts[13] = JsonStr("comment",     PositionGetString(POSITION_COMMENT));

      if(written > 0)
         out += ",";
      out += JsonObject(parts);
      written++;
   }

   return out + "]";
}

//--- Deals closed since the window the server asked for. Grouped by position
//--- so a position closed in parts reports as one closed trade.
string BuildClosedDeals(void)
{
   datetime from = (g_historyFrom == "") ? (TimeCurrent() - 3600) : ParseIsoUtcToServer(g_historyFrom);
   if(from <= 0)
      from = TimeCurrent() - 3600;

   if(!HistorySelect(from, TimeCurrent() + 60))
      return "[]";

   string out = "[";
   int written = 0;

   const int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      const ulong deal = HistoryDealGetTicket(i);
      if(deal == 0)
         continue;

      //--- Only exits carry a realised result.
      if(HistoryDealGetInteger(deal, DEAL_ENTRY) != DEAL_ENTRY_OUT)
         continue;

      const long   positionId = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      const string symbol     = HistoryDealGetString(deal, DEAL_SYMBOL);
      const int    digits     = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

      //--- The closing deal is the opposite side of the position, so the
      //--- position's own direction is the inverse of this deal's type.
      const bool closedLong = (HistoryDealGetInteger(deal, DEAL_TYPE) == DEAL_TYPE_SELL);

      double openPrice = 0.0;
      datetime openTime = 0;
      FindPositionEntry(positionId, openPrice, openTime);

      string parts[];
      ArrayResize(parts, 13);
      parts[0]  = JsonStr("ticket",     IntegerToString(positionId));
      parts[1]  = JsonStr("positionId", IntegerToString(positionId));
      parts[2]  = JsonStr("magic",      IntegerToString(HistoryDealGetInteger(deal, DEAL_MAGIC)));
      parts[3]  = JsonStr("symbol",     symbol);
      parts[4]  = JsonStr("direction",  closedLong ? "BUY" : "SELL");
      parts[5]  = JsonNum("volume",     HistoryDealGetDouble(deal, DEAL_VOLUME), 2);
      parts[6]  = JsonNum("openPrice",  (openPrice > 0) ? openPrice : HistoryDealGetDouble(deal, DEAL_PRICE), digits);
      parts[7]  = JsonNum("closePrice", HistoryDealGetDouble(deal, DEAL_PRICE), digits);
      parts[8]  = JsonNum("profit",     HistoryDealGetDouble(deal, DEAL_PROFIT), 2);
      parts[9]  = JsonNum("swap",       HistoryDealGetDouble(deal, DEAL_SWAP), 2);
      parts[10] = JsonNum("commission", HistoryDealGetDouble(deal, DEAL_COMMISSION), 2);
      parts[11] = JsonStr("openTime",   IsoUtc((openTime > 0) ? openTime : (datetime)HistoryDealGetInteger(deal, DEAL_TIME)));
      parts[12] = JsonStr("closeTime",  IsoUtc((datetime)HistoryDealGetInteger(deal, DEAL_TIME)));

      if(written > 0)
         out += ",";
      out += JsonObject(parts);
      written++;

      if(written >= 200)
         break;
   }

   return out + "]";
}

void FindPositionEntry(const long positionId, double &price, datetime &time)
{
   const int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      const ulong deal = HistoryDealGetTicket(i);
      if(deal == 0)
         continue;
      if(HistoryDealGetInteger(deal, DEAL_POSITION_ID) != positionId)
         continue;
      if(HistoryDealGetInteger(deal, DEAL_ENTRY) != DEAL_ENTRY_IN)
         continue;

      price = HistoryDealGetDouble(deal, DEAL_PRICE);
      time  = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
      return;
   }
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

//--- Volume limits for the symbols the server is about to send us orders in.
//--- The terminal is the only authority on these, so the server sizes trades
//--- and we report what the broker will actually accept.
string BuildSymbolSpecs(void)
{
   string out = "[";
   int written = 0;

   for(int i = 0; i < ArraySize(g_watchSymbols); i++)
   {
      const string symbol = g_watchSymbols[i];
      if(StringLen(symbol) == 0)
         continue;

      if(!SymbolSelect(symbol, true))
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
      parts[0] = JsonStr("symbol",       symbol);
      parts[1] = JsonNum("volumeMin",    SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN), 4);
      parts[2] = JsonNum("volumeMax",    SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX), 4);
      parts[3] = JsonNum("volumeStep",   SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), 4);
      parts[4] = JsonRaw("digits",       IntegerToString(SymbolInfoInteger(symbol, SYMBOL_DIGITS)));
      parts[5] = JsonNum("point",        SymbolInfoDouble(symbol, SYMBOL_POINT), 8);
      parts[6] = JsonBool("tradable",
                          SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_DISABLED);

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

   //--- Drop results the server has recorded; anything it did not acknowledge
   //--- stays queued and is retransmitted on the next sync.
   JsonNode *ack = root.Find("acknowledged");
   if(ack != NULL)
      ForgetAcknowledged(ack);

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
   if(commands != NULL && commands.Size() > 0)
   {
      for(int i = 0; i < commands.Size(); i++)
         ExecuteCommand(commands.At(i));
   }

   delete root;

   if(VerboseLog)
      Print("TradeOS: sync ok");
}

void ForgetAcknowledged(JsonNode *ack)
{
   for(int a = 0; a < ack.Size(); a++)
   {
      JsonNode *item = ack.At(a);
      if(item == NULL)
         continue;
      RemoveResult(item.str);
   }
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

   //--- Belt and braces against a duplicated instruction. The server already
   //--- guarantees one task per master event; this makes a repeat harmless
   //--- even if that guarantee ever fails.
   if(AlreadyExecuted(taskId))
   {
      Print("TradeOS: ignoring repeat of task ", taskId);
      return;
   }

   //--- A command that sat in a queue too long is a new trade at a price the
   //--- user never chose. Refuse it and say so.
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
   const long   magic   = (long)command.GetNum("magic");
   const string comment = command.GetStr("comment");

   if(!SymbolSelect(symbol, true))
   {
      RecordResult(taskId, "FAILED", "", 0,
                   "Symbol " + symbol + " is not available on this broker", 0);
      return;
   }

   //--- The server sized the trade; the broker has the final say on what is
   //--- actually sendable, so normalise here where the real limits live.
   string adjustment = "";
   volume = NormalizeVolume(symbol, volume, adjustment);

   if(volume <= 0.0)
   {
      RecordResult(taskId, "FAILED", "", 0,
                   "Volume is below this broker's minimum for " + symbol, 0);
      return;
   }

   CTrade trade;
   trade.SetExpertMagicNumber(magic);
   trade.SetDeviationInPoints(SlippagePoints > 0 ? SlippagePoints : 20);
   trade.SetTypeFillingBySymbol(symbol);

   const bool isBuy = (dir == "BUY");
   const bool sent  = isBuy
                      ? trade.Buy(volume, symbol, 0.0, sl, tp, comment)
                      : trade.Sell(volume, symbol, 0.0, sl, tp, comment);

   const uint retcode = trade.ResultRetcode();

   if(!sent || (retcode != TRADE_RETCODE_DONE && retcode != TRADE_RETCODE_PLACED))
   {
      RecordResult(taskId, "FAILED", "", (int)retcode,
                   trade.ResultRetcodeDescription(), 0);
      Print("TradeOS: open failed on ", symbol, " — ", retcode, " ",
            trade.ResultRetcodeDescription());
      return;
   }

   //--- Resolve the position ticket from the resulting deal: the order ticket
   //--- and the position ticket are not always the same number.
   string ticket = IntegerToString((long)trade.ResultOrder());
   const ulong deal = trade.ResultDeal();
   if(deal > 0 && HistoryDealSelect(deal))
      ticket = IntegerToString(HistoryDealGetInteger(deal, DEAL_POSITION_ID));

   string note = "Opened " + dir + " " + DoubleToString(volume, 2) + " " + symbol;
   if(adjustment != "")
      note += " (" + adjustment + ")";

   RecordResult(taskId, "SUCCESS", ticket, (int)retcode, note, trade.ResultPrice());
   Print("TradeOS: ", note, " ticket ", ticket);
}

void ExecuteClose(JsonNode *command, const string taskId)
{
   const string target = command.GetStr("targetTicket");
   const ulong ticket  = (ulong)StringToInteger(target);

   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      //--- Already gone: the user may have closed it by hand. That is a
      //--- successful outcome for a close instruction, not a failure.
      RecordResult(taskId, "SKIPPED", target, 0, "Position is already closed", 0);
      return;
   }

   CTrade trade;
   trade.SetDeviationInPoints(SlippagePoints > 0 ? SlippagePoints : 20);

   const bool sent = trade.PositionClose(ticket);
   const uint retcode = trade.ResultRetcode();

   if(!sent || (retcode != TRADE_RETCODE_DONE && retcode != TRADE_RETCODE_PLACED))
   {
      RecordResult(taskId, "FAILED", target, (int)retcode,
                   trade.ResultRetcodeDescription(), 0);
      return;
   }

   RecordResult(taskId, "SUCCESS", target, (int)retcode, "Position closed",
                trade.ResultPrice());
   Print("TradeOS: closed ticket ", target);
}

void ExecuteModify(JsonNode *command, const string taskId)
{
   const string target = command.GetStr("targetTicket");
   const ulong ticket  = (ulong)StringToInteger(target);

   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      RecordResult(taskId, "SKIPPED", target, 0, "Position no longer open", 0);
      return;
   }

   const double sl = command.GetNum("stopLoss");
   const double tp = command.GetNum("takeProfit");

   CTrade trade;
   const bool sent = trade.PositionModify(ticket, sl, tp);
   const uint retcode = trade.ResultRetcode();

   if(!sent || (retcode != TRADE_RETCODE_DONE && retcode != TRADE_RETCODE_PLACED))
   {
      RecordResult(taskId, "FAILED", target, (int)retcode,
                   trade.ResultRetcodeDescription(), 0);
      return;
   }

   RecordResult(taskId, "SUCCESS", target, (int)retcode, "Stops updated", 0);
}

//--- Clamps to the broker's min/max and snaps to its volume step.
double NormalizeVolume(const string symbol, const double requested, string &note)
{
   const double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   const double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   const double step    = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   double volume = requested;

   if(maxLot > 0 && volume > maxLot)
   {
      volume = maxLot;
      note = StringFormat("capped at broker maximum %s", DoubleToString(maxLot, 2));
   }

   if(step > 0)
      volume = MathFloor(volume / step + 0.5) * step;

   //--- Round-tripping through the step can land just under the minimum.
   if(minLot > 0 && volume < minLot)
   {
      //--- Only nudge up when the shortfall is a rounding artefact; otherwise
      //--- refuse, rather than trade more risk than was configured.
      if(requested >= minLot * 0.9)
      {
         volume = minLot;
         note = StringFormat("raised to broker minimum %s", DoubleToString(minLot, 2));
      }
      else
         return 0.0;
   }

   //--- Trim floating point residue introduced by the step arithmetic.
   return NormalizeDouble(volume, 2);
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
   ArrayResize(g_resVolume,  n + 1);

   g_resTaskId[n]  = taskId;
   g_resStatus[n]  = status;
   g_resTicket[n]  = ticket;
   g_resRetcode[n] = retcode;
   g_resMessage[n] = message;
   g_resPrice[n]   = price;
   g_resVolume[n]  = 0;
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
         g_resVolume[j]  = g_resVolume[j + 1];
      }

      ArrayResize(g_resTaskId,  total - 1);
      ArrayResize(g_resStatus,  total - 1);
      ArrayResize(g_resTicket,  total - 1);
      ArrayResize(g_resRetcode, total - 1);
      ArrayResize(g_resMessage, total - 1);
      ArrayResize(g_resPrice,   total - 1);
      ArrayResize(g_resVolume,  total - 1);
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
   int n = ArraySize(g_doneTasks);

   //--- Bounded history: keep the most recent ids and drop the oldest.
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

   //--- StringToCharArray appends a terminating zero; excluding it keeps the
   //--- Content-Length honest, which some proxies are strict about.
   const int len = StringToCharArray(body, post, 0, StringLen(body), CP_UTF8) - 1;
   if(len > 0)
      ArrayResize(post, len);

   ResetLastError();
   const int status = WebRequest("POST", ApiUrl + path, headers, HTTP_TIMEOUT_MS,
                                 post, result, resultHeaders);

   if(status == -1)
   {
      const int error = GetLastError();
      if(error == 4014 && !g_warnedWebReq)
      {
         g_warnedWebReq = true;
         Print("TradeOS: WebRequest is not permitted for ", ApiUrl,
               ". Add it under Tools > Options > Expert Advisors > ",
               "\"Allow WebRequest for listed URL\".");
      }
      else if(error != 4014)
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

//--- Server time is broker-local. Everything on the wire is UTC, so the
//--- broker's offset is applied here rather than guessed at the other end.
string IsoUtc(const datetime serverTime)
{
   const int offset = (int)(TimeGMT() - TimeCurrent());
   const datetime utc = serverTime + offset;

   MqlDateTime dt;
   TimeToStruct(utc, dt);

   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
}

//--- Inverse of IsoUtc: an ISO-8601 UTC string back to broker-server time.
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
