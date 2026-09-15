# Test plan

Written for: whoever signs off that this is safe to point at real money.

PRD phases 5 and 6. The automated suite covers the logic; this document covers
what only a real terminal and a real broker can tell you.

---

## Automated

```bash
npm test
```

**Unit** (`apps/api/test/copy-rules.test.ts`) — the pure risk and statistics
functions: every sizing mode, user and broker volume guards, the reject-rather-
than-inflate rule, floating-point rounding, direction reversal, symbol mapping,
dedupe key derivation, and the statistics and drawdown maths.

**End-to-end** (`apps/api/test/copy-flow.e2e.test.ts`) — the whole PRD §40
success path through the real HTTP surface against a real database: sign up,
connect a master, pair its agent, reject a code used on the wrong terminal,
connect a follower, enable a 0.5 multiplier, open a master trade, confirm one
correctly sized task, **replay the identical snapshot three times and confirm
still exactly one task**, dispatch, execute, link the follower position to the
master, close, propagate the close, read the event log, and confirm the
emergency stop blocks new copies without touching open positions.

---

## Manual, on demo accounts

Run all of it before connecting anything funded. One master, five followers is
the PRD's target shape.

### Connection and recovery

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Attach the agent with a valid code | Status reaches `Connected`; balance and equity populate |
| 2 | Attach with an expired code | Clear rejection; new code works |
| 3 | Attach to a terminal on a different account | Rejected, naming the expected account number |
| 4 | Pull the network cable for 60s | Account goes `Disconnected` within 30s, notification and email arrive; recovers on its own |
| 5 | Restart MetaTrader | Reconnects using the saved token, no re-pairing |
| 6 | Restart the API while trades are open | No duplicate copies; state reconciles from the next snapshot |
| 7 | Remove the EA from the chart | Account goes offline immediately, not after a timeout |
| 8 | Disable Algo Trading in the terminal | `tradeAllowed: false` surfaces on the account before copies start failing |

### Copying

| # | Do this | Expect |
| --- | --- | --- |
| 9 | Master opens 1.00 lot, follower on ×0.5 | Follower opens 0.50 within a second or two |
| 10 | Same, follower on fixed 0.10 | Follower opens 0.10 regardless of master size |
| 11 | Same, follower on same-lot | Follower opens 1.00 |
| 12 | Master closes | Follower closes; both appear in history |
| 13 | Master moves SL/TP | Follower's stops follow; **no second trade opens** |
| 14 | Master opens and closes within a second | Exactly one open and one close on the follower |
| 15 | Master opens 3 trades at once | Exactly 3 copies, correctly sized |
| 16 | Turn off one follower, master trades | Only the enabled followers copy |
| 17 | Global copy switch off, master trades | Nothing copies; open positions unaffected |
| 18 | Reverse copying on, master buys | Follower sells |
| 19 | Map `XAUUSD → GOLD`, master trades gold | Follower trades GOLD |

### Failure paths — each must fail with the *correct, visible* reason

| # | Set up | Expect in the copy log |
| --- | --- | --- |
| 20 | Follower with almost no free margin | `Insufficient margin`, no retry storm |
| 21 | Master trades a symbol the follower's broker lacks | `Symbol unavailable on this broker` |
| 22 | Trade at market close | `Market closed` |
| 23 | Multiplier so small it rounds below the broker minimum | Skipped with the computed size named — **not** rounded up |
| 24 | Follower offline when the master trades | Task expires after 60s and says so; no late fill on reconnect |
| 25 | Follower comes back after expiry | No stale trade appears |

### Duplicate prevention — the ones that matter most

| # | Do this | Expect |
| --- | --- | --- |
| 26 | Kill and restart the agent mid-copy | No second trade |
| 27 | Restart the API between dispatch and result | No second trade |
| 28 | Run two API instances against one database | No second trade |
| 29 | Master already holds 5 positions when first connected | All 5 recorded, **none copied**, each logged as skipped with the reason |

### Controls

| # | Do this | Expect |
| --- | --- | --- |
| 30 | Emergency stop with trades open | All copying off, queued work cancelled, **open positions untouched** |
| 31 | Close All with confirmation | Every open position queued to close; failures reported individually |
| 32 | Remove an account with open copies | Copying stops; history retained; broker positions untouched |

### Dashboard

| # | Check |
| --- | --- |
| 33 | Equity and P/L update without a refresh |
| 34 | Heartbeat age is visible and accurate on every account |
| 35 | Disconnecting shows the offline banner |
| 36 | Today's P/L matches the broker's for your timezone (set it in Settings) |
| 37 | Statistics agree with the terminal's own report |
| 38 | Usable on a phone browser |

---

## Load

The V1 target is 11 accounts per user. At a 1s poll that is ~11 requests/sec per
user, each doing a handful of indexed queries. Before raising
`MAX_FOLLOWER_ACCOUNTS` materially, measure `/agent/v1/sync` latency under the
intended account count and watch the Postgres connection pool.

---

## Sign-off

Do not connect a funded account until every case above passes on demo, twice,
on separate days — including at least one weekend market close.
