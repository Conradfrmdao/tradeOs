# Agent protocol v1

Written for: anyone implementing or debugging a TradeOS terminal agent.

The contract between a MetaTrader terminal and the TradeOS API. Two endpoints
carry the whole runtime.

## Conventions

- JSON over HTTPS. `Content-Type: application/json`.
- All timestamps are ISO-8601 **UTC**: `2026-09-15T14:05:12Z`. Broker server
  time is not UTC; the agent converts using `TimeGMT() - TimeCurrent()`.
- All prices and volumes are JSON numbers in fixed notation, never
  locale-formatted strings.
- Unknown fields are ignored, so the agent and the API can be deployed
  independently as long as `protocolVersion` matches.
- Errors are `{ "error": { "code", "message", "fields"? } }` with a 4xx/5xx
  status.

---

## POST /agent/v1/pair

Exchanges a single-use pairing code for a long-lived bearer token. Rate limited
to 10 attempts per 5 minutes per IP.

**Request**

```json
{
  "pairingCode": "7K4M-PQ2X-9WTB",
  "platform": "MT5",
  "accountNumber": "12345678",
  "server": "Broker-Live01",
  "broker": "Broker Ltd",
  "currency": "USD",
  "leverage": 100,
  "agentVersion": "1.0.0",
  "terminalBuild": "4620"
}
```

`accountNumber` **must** match the account the code was issued for. A mismatch
is rejected with a message naming the expected account — pairing the wrong
terminal would silently mirror trades from an account the user never connected.

**Response `200`**

```json
{
  "token": "…",
  "accountId": "uuid",
  "accountName": "My Master",
  "role": "MASTER",
  "protocolVersion": 1,
  "pollIntervalMs": 1000
}
```

The code is burned on success. Store the token; only its SHA-256 is kept
server-side.

---

## POST /agent/v1/sync

`Authorization: Bearer <token>`. Called every `pollIntervalMs`. This is the
entire runtime loop: it pushes state and the results of previous commands, and
receives the next batch of commands.

**Request**

```json
{
  "protocolVersion": 1,
  "agentVersion": "1.0.0",
  "terminalBuild": "4620",

  "account": {
    "balance": 10000.00,
    "equity": 10450.00,
    "margin": 320.50,
    "freeMargin": 10129.50,
    "marginLevel": 3260.53,
    "credit": 0,
    "currency": "USD",
    "leverage": 100,
    "tradeAllowed": true,
    "serverTime": "2026-09-15T14:05:12Z"
  },

  "positions": [
    {
      "ticket": "500001",
      "positionId": "500001",
      "magic": "770145",
      "symbol": "EURUSD",
      "direction": "BUY",
      "volume": 1.0,
      "openPrice": 1.17000,
      "currentPrice": 1.17200,
      "stopLoss": 1.16500,
      "takeProfit": 1.18000,
      "profit": 200.00,
      "swap": 0,
      "commission": -7.00,
      "openTime": "2026-09-15T13:55:00Z",
      "comment": "tos:9f3c2a1b"
    }
  ],

  "closed":  [ /* positions closed since `historyFrom`, plus closePrice/closeTime */ ],
  "results": [ /* outcomes of previously issued commands */ ],
  "symbolSpecs": [ /* volume limits for the symbols in `watchSymbols` */ ]
}
```

### `positions` is a full snapshot, not a delta

This is the most important rule in the protocol. Send **every** open position
on every sync. The server diffs it against what it last saw, which is what makes
a missed poll, a terminal restart or a server restart harmless.

### `results`

```json
{
  "taskId": "uuid",
  "status": "SUCCESS" | "FAILED" | "SKIPPED",
  "ticket": "900001",
  "retcode": 10009,
  "errorCode": "INSUFFICIENT_MARGIN",
  "message": "…",
  "executedPrice": 1.17010,
  "executedVolume": 0.5
}
```

Keep sending a result until its `taskId` appears in `acknowledged`. Results are
at-least-once; the server settles each task once and ignores repeats.

`retcode` is the raw MT5 `TRADE_RETCODE_*` or MT4 `GetLastError()` value. The
server maps it to a user-facing reason and keeps the raw number for support.

**Response `200`**

```json
{
  "protocolVersion": 1,
  "serverTime": "2026-09-15T14:05:12Z",
  "pollIntervalMs": 1000,
  "accountId": "uuid",
  "role": "FOLLOWER",
  "copyingEnabled": true,
  "historyFrom": "2026-09-15T14:00:12Z",
  "watchSymbols": ["EURUSD", "GOLD"],
  "commands": [
    {
      "id": "uuid",
      "action": "OPEN",
      "symbol": "EURUSD",
      "direction": "BUY",
      "volume": 0.5,
      "stopLoss": 1.16500,
      "takeProfit": 1.18000,
      "slippagePoints": 20,
      "magic": 770145,
      "comment": "tos:9f3c2a1b",
      "expiresAt": "2026-09-15T14:06:12Z"
    }
  ],
  "acknowledged": ["uuid"]
}
```

| Field | Meaning |
| --- | --- |
| `copyingEnabled` | global kill switch **and** this follower's own switch |
| `historyFrom` | pull closed deals from here on the next sync (overlaps deliberately) |
| `watchSymbols` | report `symbolSpecs` for these — what the master currently trades, mapped for this follower |
| `acknowledged` | task ids whose results were recorded; stop resending them |

### Commands

| Action | Fields used |
| --- | --- |
| `OPEN` | `symbol`, `direction`, `volume`, `stopLoss`, `takeProfit`, `slippagePoints`, `magic`, `comment` |
| `CLOSE` | `targetTicket` — the follower's own ticket |
| `MODIFY` | `targetTicket`, `stopLoss`, `takeProfit` |

### Agent obligations

1. **Never execute the same `id` twice.** Keep a bounded list of executed ids.
   The server guarantees one task per master event; this makes a repeat harmless
   if that guarantee ever fails.
2. **Respect `expiresAt`.** Past it, report `SKIPPED` rather than executing — a
   late fill is a new trade at a price the user never chose.
3. **Normalise volume against the broker.** The server sizes the trade from the
   user's risk rule; the terminal clamps to `SYMBOL_VOLUME_MIN/MAX` and snaps to
   `SYMBOL_VOLUME_STEP`. If the result is below the minimum, fail with a reason
   rather than rounding a trade up into more risk than was configured.
4. **Report every command's outcome**, including skips.

---

## POST /agent/v1/unpair

`Authorization: Bearer <token>`, empty body. Called when the EA is removed from
a chart. Revokes the token and marks the account disconnected immediately, which
is cleaner than waiting for a heartbeat timeout.

---

## Lifecycle and failure modes

| Situation | Behaviour |
| --- | --- |
| `401` from sync | Token revoked. Delete it, stop polling, tell the user to re-pair. |
| Non-200, non-401 | Transient. Keep polling; do not clear state. |
| No sync for `AGENT_HEARTBEAT_TIMEOUT_SECONDS` (default 30) | Server marks the account `DISCONNECTED`, logs an event, notifies and emails. |
| `tradeAllowed: false` | Surfaced on the account as an error, so copy failures are explained before they happen rather than after. |
| Protocol version mismatch | `400` naming both versions. Update the agent. |

---

## Rate limits

| Endpoint | Limit |
| --- | --- |
| `/agent/v1/pair` | 10 per 5 min |
| `/agent/v1/sync` | 400 per min, keyed on the bearer token |

Keying on the token rather than the IP matters because several terminals often
share one outbound address; one busy account must not throttle another.
