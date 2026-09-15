//+------------------------------------------------------------------+
//|                                                     JsonLite.mqh |
//|              Minimal JSON reader/writer for the TradeOS agent     |
//+------------------------------------------------------------------+
//| MQL has no JSON support, and the TradeOS protocol is JSON over    |
//| HTTPS, so the agent carries its own.                              |
//|                                                                   |
//| Scope is deliberately small: enough to parse a sync response and  |
//| build a sync request, with correct string escaping and no locale- |
//| dependent number formatting. It is not a general JSON library.    |
//|                                                                   |
//| Shared verbatim by the MT4 and MT5 agents.                        |
//+------------------------------------------------------------------+
#property strict

#ifndef TRADEOS_JSONLITE_MQH
#define TRADEOS_JSONLITE_MQH

enum JsonType
{
   JSON_UNDEFINED = 0,
   JSON_NULL      = 1,
   JSON_BOOL      = 2,
   JSON_NUMBER    = 3,
   JSON_STRING    = 4,
   JSON_ARRAY     = 5,
   JSON_OBJECT    = 6
};

//+------------------------------------------------------------------+
//| One node of a parsed JSON document.                              |
//| Owns its children: deleting the root frees the whole tree.       |
//+------------------------------------------------------------------+
class JsonNode
{
public:
   JsonType   type;
   string     key;
   string     str;
   double     num;
   bool       flag;
   JsonNode  *kids[];

                     JsonNode(void) { type = JSON_UNDEFINED; key = ""; str = ""; num = 0.0; flag = false; }
                    ~JsonNode(void)
   {
      for(int i = 0; i < ArraySize(kids); i++)
         if(CheckPointer(kids[i]) == POINTER_DYNAMIC)
            delete kids[i];
      ArrayFree(kids);
   }

   int Size(void) const { return ArraySize(kids); }

   JsonNode *At(const int index)
   {
      if(index < 0 || index >= ArraySize(kids))
         return NULL;
      return kids[index];
   }

   //--- Object lookup by key. Returns NULL when absent, so callers can
   //--- distinguish "missing" from "present but zero".
   JsonNode *Find(const string name)
   {
      for(int i = 0; i < ArraySize(kids); i++)
         if(kids[i] != NULL && kids[i].key == name)
            return kids[i];
      return NULL;
   }

   bool Has(const string name) { return Find(name) != NULL; }

   string GetStr(const string name, const string fallback = "")
   {
      JsonNode *n = Find(name);
      if(n == NULL)
         return fallback;
      if(n.type == JSON_STRING)
         return n.str;
      if(n.type == JSON_NUMBER)
         return DoubleToString(n.num, 8);
      return fallback;
   }

   double GetNum(const string name, const double fallback = 0.0)
   {
      JsonNode *n = Find(name);
      if(n == NULL)
         return fallback;
      if(n.type == JSON_NUMBER)
         return n.num;
      if(n.type == JSON_STRING)
         return StringToDouble(n.str);
      return fallback;
   }

   bool GetBool(const string name, const bool fallback = false)
   {
      JsonNode *n = Find(name);
      if(n == NULL)
         return fallback;
      if(n.type == JSON_BOOL)
         return n.flag;
      if(n.type == JSON_NUMBER)
         return n.num != 0.0;
      return fallback;
   }

   void Add(JsonNode *child)
   {
      const int n = ArraySize(kids);
      ArrayResize(kids, n + 1);
      kids[n] = child;
   }
};

//+------------------------------------------------------------------+
//| Recursive-descent parser                                         |
//+------------------------------------------------------------------+
class JsonParser
{
private:
   string m_text;
   int    m_pos;
   int    m_len;
   bool   m_ok;

   void SkipSpace(void)
   {
      while(m_pos < m_len)
      {
         const ushort c = StringGetCharacter(m_text, m_pos);
         if(c == ' ' || c == '\t' || c == '\n' || c == '\r')
            m_pos++;
         else
            break;
      }
   }

   ushort Peek(void) { return (m_pos < m_len) ? StringGetCharacter(m_text, m_pos) : 0; }

   bool Expect(const ushort c)
   {
      SkipSpace();
      if(Peek() != c)
      {
         m_ok = false;
         return false;
      }
      m_pos++;
      return true;
   }

   //--- Reads a JSON string literal, resolving the escape sequences the
   //--- server can emit. \u is decoded so broker symbol names survive.
   string ParseString(void)
   {
      string out = "";
      if(!Expect('"'))
         return out;

      while(m_pos < m_len)
      {
         const ushort c = StringGetCharacter(m_text, m_pos);
         m_pos++;

         if(c == '"')
            return out;

         if(c != '\\')
         {
            out += ShortToString(c);
            continue;
         }

         if(m_pos >= m_len)
            break;

         const ushort esc = StringGetCharacter(m_text, m_pos);
         m_pos++;

         switch(esc)
         {
            case '"':  out += "\"";               break;
            case '\\': out += "\\";               break;
            case '/':  out += "/";                break;
            case 'b':  out += ShortToString(8);   break;
            case 'f':  out += ShortToString(12);  break;
            case 'n':  out += "\n";               break;
            case 'r':  out += "\r";               break;
            case 't':  out += "\t";               break;
            case 'u':
            {
               if(m_pos + 4 <= m_len)
               {
                  const string hex = StringSubstr(m_text, m_pos, 4);
                  m_pos += 4;
                  out += ShortToString((ushort)HexToInt(hex));
               }
               break;
            }
            default: out += ShortToString(esc); break;
         }
      }

      m_ok = false;
      return out;
   }

   static int HexToInt(const string hex)
   {
      int value = 0;
      for(int i = 0; i < StringLen(hex); i++)
      {
         const ushort c = StringGetCharacter(hex, i);
         int digit = -1;
         if(c >= '0' && c <= '9')      digit = c - '0';
         else if(c >= 'a' && c <= 'f') digit = 10 + (c - 'a');
         else if(c >= 'A' && c <= 'F') digit = 10 + (c - 'A');
         if(digit < 0)
            return value;
         value = value * 16 + digit;
      }
      return value;
   }

   JsonNode *ParseValue(void)
   {
      SkipSpace();
      if(m_pos >= m_len)
      {
         m_ok = false;
         return NULL;
      }

      const ushort c = Peek();

      if(c == '{')  return ParseObject();
      if(c == '[')  return ParseArray();

      JsonNode *node = new JsonNode();

      if(c == '"')
      {
         node.type = JSON_STRING;
         node.str  = ParseString();
         return node;
      }

      if(c == 't' || c == 'f')
      {
         const bool isTrue = (c == 't');
         m_pos += isTrue ? 4 : 5;
         node.type = JSON_BOOL;
         node.flag = isTrue;
         return node;
      }

      if(c == 'n')
      {
         m_pos += 4;
         node.type = JSON_NULL;
         return node;
      }

      //--- number
      const int start = m_pos;
      while(m_pos < m_len)
      {
         const ushort d = StringGetCharacter(m_text, m_pos);
         if((d >= '0' && d <= '9') || d == '-' || d == '+' || d == '.' || d == 'e' || d == 'E')
            m_pos++;
         else
            break;
      }

      if(m_pos == start)
      {
         m_ok = false;
         delete node;
         return NULL;
      }

      node.type = JSON_NUMBER;
      node.num  = StringToDouble(StringSubstr(m_text, start, m_pos - start));
      return node;
   }

   JsonNode *ParseObject(void)
   {
      if(!Expect('{'))
         return NULL;

      JsonNode *node = new JsonNode();
      node.type = JSON_OBJECT;

      SkipSpace();
      if(Peek() == '}')
      {
         m_pos++;
         return node;
      }

      while(m_pos < m_len && m_ok)
      {
         SkipSpace();
         const string name = ParseString();
         if(!Expect(':'))
            break;

         JsonNode *value = ParseValue();
         if(value == NULL)
            break;

         value.key = name;
         node.Add(value);

         SkipSpace();
         const ushort c = Peek();
         if(c == ',') { m_pos++; continue; }
         if(c == '}') { m_pos++; return node; }

         m_ok = false;
         break;
      }

      return node;
   }

   JsonNode *ParseArray(void)
   {
      if(!Expect('['))
         return NULL;

      JsonNode *node = new JsonNode();
      node.type = JSON_ARRAY;

      SkipSpace();
      if(Peek() == ']')
      {
         m_pos++;
         return node;
      }

      while(m_pos < m_len && m_ok)
      {
         JsonNode *value = ParseValue();
         if(value == NULL)
            break;

         node.Add(value);

         SkipSpace();
         const ushort c = Peek();
         if(c == ',') { m_pos++; continue; }
         if(c == ']') { m_pos++; return node; }

         m_ok = false;
         break;
      }

      return node;
   }

public:
   //--- Caller owns the returned node and must delete it.
   JsonNode *Parse(const string text)
   {
      m_text = text;
      m_pos  = 0;
      m_len  = StringLen(text);
      m_ok   = true;

      JsonNode *root = ParseValue();

      if(!m_ok && root != NULL)
      {
         delete root;
         return NULL;
      }
      return root;
   }
};

//+------------------------------------------------------------------+
//| Writing helpers                                                  |
//+------------------------------------------------------------------+

//--- Escapes a string for inclusion in JSON. Control characters are
//--- escaped rather than passed through, because broker comments and
//--- symbol names are not guaranteed to be clean.
string JsonEscape(const string value)
{
   string out = "";
   const int len = StringLen(value);

   for(int i = 0; i < len; i++)
   {
      const ushort c = StringGetCharacter(value, i);
      switch(c)
      {
         case '"':  out += "\\\"";  break;
         case '\\': out += "\\\\";  break;
         case '\n': out += "\\n";   break;
         case '\r': out += "\\r";   break;
         case '\t': out += "\\t";   break;
         default:
            if(c < 32)
               out += StringFormat("\\u%04x", c);
            else
               out += ShortToString(c);
      }
   }
   return out;
}

string JsonStr(const string key, const string value)
{
   return StringFormat("\"%s\":\"%s\"", key, JsonEscape(value));
}

//--- Numbers are always written in fixed notation with an explicit digit
//--- count: MQL's default formatting can emit scientific notation, which
//--- would still parse but makes logs unreadable.
string JsonNum(const string key, const double value, const int digits = 8)
{
   return StringFormat("\"%s\":%s", key, DoubleToString(value, digits));
}

string JsonBool(const string key, const bool value)
{
   return StringFormat("\"%s\":%s", key, value ? "true" : "false");
}

string JsonRaw(const string key, const string rawValue)
{
   return StringFormat("\"%s\":%s", key, rawValue);
}

//--- Joins already-rendered "key":value fragments into an object.
string JsonObject(const string &parts[])
{
   string out = "{";
   for(int i = 0; i < ArraySize(parts); i++)
   {
      if(i > 0)
         out += ",";
      out += parts[i];
   }
   return out + "}";
}

#endif // TRADEOS_JSONLITE_MQH
//+------------------------------------------------------------------+
