# Architecture

Written for: engineers working on or reviewing this codebase.

---

## The shape of the system

```
                         Browser
                            │
             REST (cookies) │ WebSocket (same session)
                            ▼
    ┌───────────────────────────────────────────────┐
    │                TradeOS API                    │
    │                                               │
    │  routes ──▶ services ──▶ copy engine          │
    │                  │            │               │
    │                  ▼            ▼               │
    │             Postgres     realtime hub         │
    └───────────────────────────────────────────────┘
                            ▲
           HTTPS, one bearer token per account
                            │
                  TradeOS agent (MQL EA)
                            │
                            ▼
                      Broker server
```

Three processes: the Next.js web app, the Fastify API, and Postgres. Redis is
optional and only carries realtime fan-out between API instances.

### Why the API is a separate long-running service

The engine needs a heartbeat supervisor, in-memory WebSocket connections, and a
process that is always up to receive agent polls. None of that fits a
request-scoped serverless model, so the web app stays a pure frontend and the
API is an ordinary long-lived server.

### Why the connector is an Expert Advisor

The alternatives were a credential-based cloud provider (MetaApi and similar)
or the MetaTrader Manager API. The EA was chosen because:

- **No trading credentials.** The terminal is already authenticated. TradeOS
  never receives a password, so there is nothing to leak. This removes the
  largest single liability in the product.
- **Broker-agnostic and free.** No per-account subscription, no broker
  allow-listing, no legal grey area around the Manager API.
- **The terminal is the authority.** Volume steps, fill modes and stop levels
  are read from the broker at the moment of execution rather than guessed.

The cost is that the user's terminal must be running. That is made visible
rather than hidden: every account shows its heartbeat age, and a silent agent
raises a status change, an event, a notification and an email.

`TradingAccount.connectorType` already distinguishes `AGENT_EA` from a reserved
`BROKER_API`, and `encryptedCredentials` exists (AES-256-GCM, versioned key) for
a future credential-based provider. The copy engine speaks only in terms of
tasks and results, so adding one does not touch the engine.

---

## The copy pipeline

```
master agent sync
   │
   ▼
diff reported positions against the database      ← ingestMasterState
   │
   ├── new position      → MASTER_OPEN   → queue OPEN tasks
   ├── stops changed     → MASTER_MODIFY → queue MODIFY tasks
   └── position gone     → MASTER_CLOSE  → queue CLOSE tasks
   │
   ▼
copy_tasks (PENDING)                              ← the idempotency boundary
   │
   ▼
follower agent sync → buildCommandsForFollower    → tasks marked DISPATCHED
   │
   ▼
terminal executes, reports back
   │
   ▼
applyCommandResults → SUCCESS / retry / FAILED    ← results.ts
```

Everything is driven by the agents polling. There is no scheduler in the copy
path, no queue worker, and no background job that can silently die: if an agent
is polling, copies flow; if it is not, the heartbeat monitor says so.

### The full-snapshot rule

An agent always sends **every** open position, never a delta. The server diffs
that snapshot against the database.

This is the single decision that makes the system robust. A dropped poll, a
terminal restart, a server restart, a network partition — none of them can lose
an event, because the next snapshot reconciles against durable state. The
database is the only memory the engine has.

### <a id="idempotency"></a>Idempotency

The requirement (PRD §42) is that a master event can be observed any number of
times and still produce exactly one trade per follower.

This is enforced by the database, not by application logic:

```prisma
model CopyTask {
  followerAccountId String
  dedupeKey         String
  @@unique([followerAccountId, dedupeKey])
}
```

`dedupeKey` is a pure function of the master event — never of the time it was
observed:

| Action | Key |
| --- | --- |
| OPEN | `open:<masterPositionId>` |
| CLOSE | `close:<masterPositionId>` |
| MODIFY | `modify:<masterPositionId>:<sl>:<tp>` |

Task creation is `createMany({ skipDuplicates: true })`, which compiles to
`INSERT ... ON CONFLICT DO NOTHING`. Two API instances racing on the same
master event, a retried request, and a replayed snapshot all converge on one
row. There is no read-then-write window to lose.

MODIFY includes the target stops, so a genuinely new stop level is a new event
while a repeated report of the same one is not. Zero and null normalise to the
same string, because MetaTrader reports "no stop" as `0.0` and the two must not
look like different events.

Three further layers sit on top:

1. Commands are marked `DISPATCHED` in the same statement that selects them, so
   two concurrent polls cannot both receive one.
2. The agent keeps a bounded list of task ids it has already executed and
   ignores repeats.
3. Every copied order carries `tos:<task-id-prefix>` in its comment, so a
   position can be traced to the instruction that created it from inside the
   terminal.

### Retry policy

Retrying on an *unknown* outcome is how copiers create duplicate trades, so the
rule is asymmetric:

- **Explicit broker failure that could succeed on a retry** (requote, price
  changed, server busy, connection lost) → re-queued, up to `COPY_MAX_ATTEMPTS`.
- **Explicit failure that could not** (insufficient margin, invalid volume,
  symbol unavailable, market closed) → fails immediately with a reason. The
  condition will not have changed a second later.
- **No result at all before expiry** → `EXPIRED`, never retried. We do not know
  whether the terminal executed it, and guessing wrong means a duplicate trade.

Expiry (`COPY_TASK_TTL_SECONDS`, default 60s) is a deliberate outcome, logged
and notified, not a failure to handle.

### Pre-existing positions

On a master's first sync, positions are recorded as a baseline and **not**
copied. Copying them would fire a burst of trades the user never asked for at
prices unrelated to the master's entries. They appear in the event log as
skipped with the reason attached.

Detection is `account.lastSyncAt == null`, so the behaviour survives a server
restart correctly: a restarted server sees a non-null `lastSyncAt` and resumes
diffing normally.

---

## Data model notes

- **Decimal everywhere for money.** `Decimal(20,8)` for prices and amounts,
  `Decimal(12,4)` for volumes. Floats are never used for value. Conversion to
  JSON numbers happens once, at the serialization edge (`lib/num.ts`).
- **Accounts are soft-deleted.** Removing an account keeps its closed trades so
  statistics and audit history survive, but revokes its agent, cancels in-flight
  tasks, and clears any stored secret material in the same transaction.
- **Equity samples throttle themselves.** The timestamp is truncated to the
  minute and upserted against `@@unique([accountId, at])`, so a once-per-second
  sync rate collapses into a clean one-per-minute series with no scheduling.
- **`copy_events` is the user-facing log; `audit_logs` is the operator-facing
  one.** They answer different questions and are kept separate deliberately.

---

## Timezones

"Today's profit" means the user's today. Every daily and range boundary is
resolved through `lib/time.ts` against the timezone on the user's settings.

`startOfLocalDay` works by subtracting the seconds elapsed in the local day from
the current instant, rather than constructing a local wall-clock date. That
sidesteps DST arithmetic entirely — it only ever moves backwards from a known
instant.

---

## Realtime

The dashboard opens one WebSocket, authenticated by the same session cookie, and
receives typed deltas (`packages/shared/src/realtime.ts`). On connect it gets a
full snapshot; after that it lives on deltas, and refetches the snapshot on
every reconnect because deltas may have been missed while it was away.

`RealtimeHub` delivers in-process and, when `REDIS_URL` is set, also publishes
to Redis so the instance that *observed* a change can reach the instance
holding the socket. Without Redis it degrades to in-process delivery, which is
correct for a single instance.

A dead connection is shown to the user. Stale numbers that look live are the
dangerous failure mode on a trading dashboard.

---

## Where V2 features slot in

| Feature | Where it goes |
| --- | --- |
| Risk-% and equity-based sizing | a new `RiskMode` plus a branch in `resolveCopyVolume` — the follower's equity already arrives on every sync |
| Daily loss limits, drawdown guards | a check in `loadEnabledCopiers`, alongside the global kill switch |
| Trading-hour and symbol restrictions | filters in `planCopy`, which already returns a typed skip-with-reason |
| Pending-order copying | a fourth `CopyAction`; the agent protocol and task model already carry it |
| Multiple masters | drop the `@unique` on `CopierSettings.followerAccountId`; the engine is already keyed on the pair |
| Credential-based provider | implement against `ConnectorType.BROKER_API`; the engine only speaks tasks and results |

---

## Known limits in V1

- **One master per follower**, enforced by a unique constraint.
- **Market orders only.** Pending orders are tracked but not copied; the
  setting exists and is off.
- **Partial closes are not mirrored.** A partial close on the master currently
  reads as no change; the `PARTIAL_CLOSE` action and dedupe key exist but no
  detection is wired to them.
- **MT5 netting accounts are not fully modelled.** Copies assume one broker
  position per copied trade, which holds on hedging accounts. Netting accounts
  merge positions and would need position-delta logic.
- **The agent requires the terminal to be running**, which is inherent to the
  approach rather than a defect, and is surfaced everywhere it matters.
