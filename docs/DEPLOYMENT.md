# Deploying TradeOS

Written for: whoever puts this on the internet.

## Two ways to deploy

**A. Everything on Vercel** (simplest, one platform, free tier)
The API runs as a Vercel function alongside the dashboard, served from `/api`
on the same domain. Same origin means no CORS and first-party cookies.

**B. Dashboard on Vercel, API on a Docker host** (Railway, Render, Fly)
Keeps live WebSocket updates and fast offline detection.

Option A is what the committed `vercel.json` does. Option B needs the root
`Dockerfile` and is described further down.

### What option A costs you

| | Option A (all Vercel) | Option B (split) |
| --- | --- | --- |
| Live updates | dashboard polls every 4s | WebSocket, instant |
| Offline detection | ~90s, driven by agent polls | ~30s, background supervisor |
| Copy latency | agent poll interval (3s default) | 1s default |
| Hosts to manage | one | two |

Neither changes how the copy engine decides anything — only how quickly it
hears about events. The agent poll interval is the dial that matters:
`AGENT_POLL_INTERVAL_MS`. Every poll is a function invocation on Vercel, so
1000ms across 11 accounts is roughly 950k invocations a month and will exceed
the free tier; 3000ms is about 320k and comfortably fits.

**Serverless mode is detected automatically** from Vercel's own environment
variables. In that mode the API skips the WebSocket server, and the heartbeat
supervisor runs opportunistically on incoming agent polls instead of on a
timer, because no timer survives between invocations.

---

## Option B: why it takes two hosts

TradeOS is two runtime pieces with different needs:

| Piece | Needs | Goes on |
| --- | --- | --- |
| `apps/web` — the dashboard | Static + server rendering | **Vercel** |
| `apps/api` — API and copy engine | A process that never stops | **Render / Railway / Fly / any Docker host** |

The API cannot run on Vercel, and the reason is structural rather than a
configuration detail. It holds the dashboard's WebSocket connections open, and
it runs a supervisor that notices within 30 seconds when a MetaTrader terminal
stops reporting. Serverless functions are request-scoped: they have no
long-lived socket and no timer that survives between requests. Putting the API
there would mean replacing live updates with polling and slowing
disconnect detection to whatever the platform's cron granularity allows —
on a product whose job is to notice a dead terminal, that is the wrong trade.

```
        Vercel                     Render / Railway / Fly
   ┌──────────────┐  REST + WS  ┌────────────────────────┐
   │ Next.js      │────────────▶│ Fastify API            │
   │ dashboard    │             │ copy engine            │
   └──────────────┘             │ heartbeat supervisor   │
                                └───────────┬────────────┘
                                            │
   MetaTrader agents ───────────────────────┤
   (HTTPS, 1s poll)                         ▼
                                     Neon Postgres
```

---

## 1. Database

Any Postgres 14+. Neon and Supabase both work on their free tiers.

Two variables, because pooled connections break migrations:

```
DATABASE_URL=postgresql://…-pooler.…/neondb?sslmode=require
DIRECT_DATABASE_URL=postgresql://….…/neondb?sslmode=require
```

`DIRECT_DATABASE_URL` is the same host **without** `-pooler`. The application
uses the pool; `prisma migrate` uses the direct connection, because a pooler
multiplexes sessions and that breaks the locks migrations depend on.

Apply the schema:

```bash
DATABASE_URL=… DIRECT_DATABASE_URL=… \
  npx prisma migrate deploy --schema packages/db/schema.prisma
```

## 2. API

### Render (blueprint included)

`render.yaml` is in the repo. In Render: **New → Blueprint**, point it at this
repository, and fill in the values marked `sync: false`. `SESSION_SECRET` is
generated for you; the rest are below.

### Railway / Fly / any Docker host

Build the root `Dockerfile` (the build context is the whole repository, because
the image needs the shared packages and the Prisma schema):

```bash
docker build -t tradeos-api .
```

Railway detects the Dockerfile automatically. Set the start command to
`node apps/api/dist/server.js` and run migrations as a pre-deploy step.

### Required environment

```bash
NODE_ENV=production
DATABASE_URL=…
DIRECT_DATABASE_URL=…

# 32+ bytes:  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
SESSION_SECRET=…
# EXACTLY 32 bytes, base64:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=…
ENCRYPTION_KEY_VERSION=1

WEB_ORIGIN=https://your-app.vercel.app     # exact origin, no trailing slash
API_PUBLIC_URL=https://your-api.onrender.com

SMTP_HOST=…                                 # see "Email" below
SMTP_PORT=587
SMTP_USER=…
SMTP_PASS=…
MAIL_FROM="TradeOS <no-reply@yourdomain.com>"
```

The process refuses to start if `SESSION_SECRET` or `ENCRYPTION_KEY` is missing
or malformed. That is deliberate — a half-configured trading system should not
boot.

`WEB_ORIGIN` must be the exact origin of your Vercel deployment. It drives both
CORS and the links in outgoing emails; a mismatch shows up as every browser
request failing CORS while `curl` works fine.

### Optional

`REDIS_URL` is only needed to run more than one API instance — it carries
realtime messages between them. On a single instance, leave it unset.

## 3. Dashboard (Vercel)

`vercel.json` already sets the monorepo build.

**Option A (all-in-one):** import the repository and leave
`NEXT_PUBLIC_API_URL` **unset**. The dashboard then calls `/api` on its own
origin, which is where the API function is served. Set every API variable from
section 2 on the Vercel project as well, since the API runs there.

**Option B (split):** set it to the API's absolute URL:

```
NEXT_PUBLIC_API_URL=https://your-api.onrender.com
```

Either way this is baked in at build time, so **changing it requires a
redeploy**, not just an environment-variable edit.

## 4. Wire the two together

1. Deploy the API. Note its URL.
2. Set `NEXT_PUBLIC_API_URL` on Vercel to that URL. Deploy the dashboard.
3. Set `WEB_ORIGIN` on the API to the Vercel URL. Redeploy the API.
4. Open the dashboard, sign up, and confirm the account appears.

Step 3 is the one people skip; without it every browser request fails CORS.

## 5. Point the agents at it

In each MetaTrader terminal, the EA's `ApiUrl` input and the WebRequest
allow-list entry (**Tools → Options → Expert Advisors**) must both be the API
URL — `https://your-api.onrender.com`, not the Vercel URL.

---

## Authentication (Clerk)

Clerk owns sign-in, sign-up, email verification and password reset. That is why
the API no longer needs SMTP for anyone to create an account.

Set on the Vercel project:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

**Development vs production instance.** A `pk_test_` / `sk_test_` pair is
Clerk's *development* instance: it works, but it shows a "Development mode"
badge, caps user numbers, and runs on `clerk.accounts.dev`. Before real users,
create a production instance in the Clerk dashboard against your own domain and
swap in the `pk_live_` / `sk_live_` keys.

### What Clerk does not touch

The MetaTrader agents authenticate with bearer tokens issued at pairing, not a
browser session. The Clerk middleware matcher in `apps/web/src/middleware.ts`
explicitly skips `/api/agent`, because those routes are called every few seconds
by every connected terminal and sending them through a session layer would add
a round trip to the copy path.

Changing auth provider therefore cannot disturb a connected terminal. That is a
property of the agent protocol, not a coincidence.

### Local user rows

TradeOS keeps its own `users` row alongside Clerk. Every trading account, trade,
copy event and audit entry hangs off it, and a trader's history has to outlive
whichever auth provider sits in front of it. Rows link by `clerkUserId`, falling
back to email so an account that existed before Clerk keeps its data when its
owner first signs in through Clerk.

## Email

Clerk sends verification and password-reset email, so **signup no longer needs
SMTP at all**.

SMTP is still used for TradeOS's own operational alerts — an account
disconnecting, a copy failing. Without it those failures are logged and
everything else keeps working; the in-dashboard notifications still appear.
Resend, Postmark, SES and Mailgun all work.

## Before real money

- **Use a paid tier for the API.** Free tiers on Render and similar sleep after
  inactivity. A sleeping API means agents cannot report and trades are not
  copied. This single setting matters more than anything else here.
- Rotate any credential that has been pasted into a chat, a ticket, or a shared
  document.
- Turn on database backups.
- Work through `docs/TESTING.md` on demo accounts first.

## Known rough edges

- The API image is ~1.1 GB because the runtime installs every workspace's
  production dependencies, including the dashboard's. It works; trimming it to
  the API's own dependencies would cut it substantially.
- `prisma migrate deploy` runs as a pre-deploy step in `render.yaml`. On a host
  without that concept, run it manually after each deploy rather than on
  container start, so scaling past one instance cannot race it.
