# TradeOS

A web platform for connecting one master MT4/MT5 account and up to ten follower
accounts, watching them from a single dashboard, and copying trades between them.

**Connect → Monitor → Copy → Analyze.**

---

## Quick start

Requirements: Node 20+, Docker, and a MetaTrader 4 or 5 terminal for the agent.

```bash
git clone <this repo> tradeos && cd tradeos
npm install

# Postgres, Redis and Mailpit (a local mail catcher)
npm run infra:up

# Generate secrets and a local .env
cp .env.example .env
node -e "const c=require('crypto');console.log('SESSION_SECRET='+c.randomBytes(32).toString('base64url'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'))"
# paste those two values into .env

npm run db:migrate          # create the schema
npm run build -w @tradeos/shared
npm run dev                 # API on :4000, web on :3000
```

Open <http://localhost:3000>, create an account, and collect the verification
email from Mailpit at <http://localhost:8025>.

| Service | URL |
| --- | --- |
| Web app | <http://localhost:3000> |
| API | <http://localhost:4000> |
| Mailpit (dev inbox) | <http://localhost:8025> |

---

## Deploying

Two hosts, because the API needs a process that stays alive — it holds the
dashboard's live connection open and notices within 30 seconds when a terminal
goes quiet. Serverless cannot do either. Full detail in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**1. API** — [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Conradfrmdao/tradeOs)

Uses the committed `render.yaml`. Fill in `DATABASE_URL`, `DIRECT_DATABASE_URL`
and `ENCRYPTION_KEY` when prompted. Note the URL it gives you.

**2. Dashboard** — [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Conradfrmdao/tradeOs&env=NEXT_PUBLIC_API_URL&envDescription=URL%20of%20your%20deployed%20TradeOS%20API)

Set `NEXT_PUBLIC_API_URL` to the API URL from step 1.

**3. Connect them** — set `WEB_ORIGIN` on the API to your Vercel URL and
redeploy the API. Skipping this is the usual cause of "everything fails in the
browser but works in curl": it is what CORS is checked against.

> On free tiers the API sleeps when idle, and a sleeping API copies no trades.
> Use a paid instance before connecting a funded account.

---

## How it connects to MetaTrader

TradeOS does **not** ask for your trading password, and does not store one.

Instead, a small Expert Advisor — the *agent* — runs inside your own MetaTrader
terminal, which is already logged in. It reports what it sees and executes the
instructions you configure in the dashboard, over HTTPS.

```
   Browser
      │  REST + WebSocket
      ▼
  TradeOS API ──── Postgres
      │            Redis (realtime fan-out)
      │  HTTPS, bearer token per account
      ▼
  TradeOS agent (Expert Advisor)
      │
      ▼
  Broker server
```

The trade-off is that your terminal has to be running for that account to be
online — which is also true of any EA-based copier, and is surfaced explicitly:
every account shows its last heartbeat, and going quiet raises an alert.

### Installing the agent

1. In MetaTrader: **Tools → Options → Expert Advisors**, tick
   *Allow WebRequest for listed URL*, and add your API URL.
2. Copy `connector/shared/JsonLite.mqh` into `MQL5/Include/TradeOS/`
   (or `MQL4/Include/TradeOS/`).
3. Copy `connector/mt5/TradeOsAgent.mq5` into `MQL5/Experts/`
   (or `connector/mt4/TradeOsAgent.mq4` into `MQL4/Experts/`) and compile it.
4. In the dashboard, add the account and copy the pairing code it shows you.
5. Drag the agent onto any chart on that account, enable **Algo Trading**, and
   paste the pairing code into the `PairingCode` input.

The pairing code is single-use and expires in 30 minutes. After pairing, the
agent stores a token and reconnects on its own.

---

## Layout

```
apps/
  api/            Fastify API, trade copy engine, agent protocol
  web/            Next.js dashboard
packages/
  shared/         Types, zod schemas, and the pure copy/risk rules
  db/             Prisma schema and migrations
connector/
  shared/         JsonLite.mqh — JSON for MQL
  mt4/            TradeOsAgent.mq4
  mt5/            TradeOsAgent.mq5
docs/             Architecture, protocol, security, test plan
```

The copy and statistics rules live in `packages/shared` as pure functions with
no I/O, so they can be tested exhaustively and reused by both apps.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web, both in watch mode |
| `npm run build` | Build all three packages |
| `npm test` | Unit tests plus the end-to-end copy flow |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:studio` | Browse the database |
| `npm run infra:up` / `infra:down` | Start/stop Postgres, Redis, Mailpit |

`npm test` runs against the development database. It creates a throwaway user
per run and deletes it afterwards.

---

## What is in V1

Authentication with email verification and password reset · one master and up
to ten followers · live balance, equity, margin and open positions · the trade
copier with same-lot, multiplier and fixed-lot sizing · stop-loss and
take-profit copying · reverse copying · symbol mapping · per-follower and
global copy switches · emergency stop and close-all · a copy event log with
per-operation failure reasons · open trades, trade history, per-account and
portfolio statistics, equity curves, account comparison · in-dashboard and
email notifications · an admin console.

Deliberately **not** in V1: signal marketplace, public profiles, payments,
mobile apps, non-MetaTrader platforms, and the advanced risk engine. See
`docs/ARCHITECTURE.md` for where those would slot in.

---

## Two behaviours worth knowing about

**Positions already open when a master connects are not copied.** The first
snapshot from a master terminal is recorded as a baseline; only changes after
that are copied. Otherwise attaching the agent to an account holding ten
positions would fire ten trades at prices that no longer relate to the entries.
Those positions appear in the event log marked as skipped, with the reason.

**A copy that cannot be executed within 60 seconds is abandoned, not retried.**
A fill a minute late is not a copy — it is a new trade at a price the user never
chose. Explicit broker failures that are worth retrying (requotes, busy server)
are retried up to three times; everything else fails fast with a reason. Both
timings are configurable in `.env`.

---

## Before real money

Run the full checklist in `docs/TESTING.md` on demo accounts first — internet
loss, terminal restart, server restart, market closed, insufficient margin, and
the duplicate-prevention cases. The copier is built so that a repeated or
replayed master event can never produce a second trade
(`docs/ARCHITECTURE.md#idempotency`), and there is an automated test for exactly
that, but your broker's behaviour is the part no test here can cover.
