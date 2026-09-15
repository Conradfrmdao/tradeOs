# Security

Written for: engineers and reviewers auditing this system.

TradeOS handles money, so this is a design constraint rather than a checklist.

---

## The largest decision

**TradeOS never receives a trading password.**

The PRD's connection flow (§6) contemplated collecting broker login credentials
and encrypting them at rest. The agent approach removes the problem instead of
mitigating it: the terminal is already authenticated, so there is no credential
to collect, store, encrypt, rotate, or leak.

`TradingAccount.encryptedCredentials` exists and is wired for AES-256-GCM with a
versioned key, reserved for a future credential-based provider. Under the V1
`AGENT_EA` connector it is always null, and no serializer reads it.

---

## Secrets at rest

| Secret | Storage |
| --- | --- |
| User password | bcrypt, cost 12 (`lib/crypto.ts`) |
| Session token | SHA-256 digest only; the raw value lives solely in the user's cookie |
| Agent bearer token | SHA-256 digest only |
| Pairing code | SHA-256 digest only, single-use, 30-minute expiry |
| Email verify / reset token | SHA-256 digest only, single-use, with expiry |
| Reserved broker credentials | AES-256-GCM, versioned key, never returned by any route |

A database leak therefore yields no usable session, no usable agent token, and
no password.

---

## Authentication

Opaque server-side sessions in an `httpOnly`, `SameSite=Lax`, `Secure`
(in production) cookie — deliberately not JWTs. A token that cannot be revoked
is the wrong primitive for a system that can place trades; here revoking is a
single `UPDATE` that takes effect on the next request.

- Sessions expire after 7 days and are revoked in bulk on password change or
  reset. A reset revokes everything; a change keeps the current session.
- Disabling a user from the admin console revokes their sessions immediately.
- 8 failed logins lock the account for 15 minutes.
- Unknown emails still pay the cost of a bcrypt comparison
  (`fakePasswordVerify`), so "no such user" and "wrong password" are
  indistinguishable by timing.
- `/auth/forgot-password` always returns the same response, so it cannot be used
  to enumerate addresses.
- Connecting a trading account requires a verified email (`requireVerified`).

## CSRF

Double-submit token: a readable `tos_csrf` cookie must be echoed in the
`x-csrf-token` header on every non-GET request that carries a session. Its
security comes from the same-origin policy preventing another site from reading
it.

Agent routes are exempt and safe to exempt: they authenticate with a bearer
token, not a cookie, so a browser carrying an ambient session cannot reach them.

## Transport and headers

`@fastify/helmet` with a `default-src 'none'` CSP (the API only ever emits JSON)
and `frame-ancestors 'none'`. CORS is pinned to `WEB_ORIGIN` with credentials
enabled — never a wildcard, which credentials would forbid anyway.

## Rate limiting

Global 300/min, with tighter per-route limits on signup, login, password reset,
verification resend, pairing-code issuance, and agent pairing. Agent syncs are
keyed on the bearer token rather than the IP, because terminals often share an
outbound address and one busy account must not throttle another.

## Input validation

Every request body and query string is parsed with a zod schema from
`packages/shared` — the same schema the frontend uses for its forms, so
client and server cannot drift. Prisma parameterises all queries; there is no
string-built SQL. React escapes all rendered output, and the app contains no
`dangerouslySetInnerHTML`.

## Logging

`lib/logger.ts` declares redaction paths centrally, so a stray
`log.info({ body })` cannot print a password, a token, or a pairing code. This
is enforced at the logger rather than at each call site precisely because call
sites are where it gets forgotten.

Nothing logs an MT4/MT5 password because nothing ever holds one.

## Audit trail

`audit_logs` records authentication events, account lifecycle changes, copier
configuration and toggles, emergency stops, close-all requests, and every admin
action, with actor, IP and user agent. `copy_events` is the separate,
user-facing record of what the copier did and why.

## Administrators

Admin routes use explicit `select` clauses, never `include`, so `passwordHash`
and `encryptedCredentials` cannot reach an admin response. An administrator can
disable a user or an account; there is nothing in the system that would let them
read the material needed to trade on one.

---

## Operational requirements

These are **not** handled by the application and must be configured in the
deployment:

- **TLS everywhere.** Cookies are only marked `Secure` when
  `NODE_ENV=production`; terminate TLS at a proxy and never serve the API over
  plain HTTP in production. MetaTrader's `WebRequest` supports HTTPS.
- **Generate real secrets.** `SESSION_SECRET` (32+ bytes) and `ENCRYPTION_KEY`
  (exactly 32 bytes, base64). The process refuses to start otherwise — a
  half-configured trading system should not boot.
- **Database backups and encryption at rest.** Postgres-side concern.
- **Key rotation.** Bump `ENCRYPTION_KEY_VERSION` alongside `ENCRYPTION_KEY`;
  envelopes record the version they were sealed with and decryption of an older
  version fails loudly rather than silently returning garbage.
- **Do not expose Postgres, Redis or Mailpit.** The bundled `docker-compose.yml`
  binds them to localhost for development only.

## Known gaps

- No two-factor authentication. It belongs on the roadmap before this handles
  significant balances.
- No per-IP anomaly detection on agent tokens beyond rate limiting.
- Session cookies are `SameSite=Lax`, which assumes the web app and API are
  same-site. A cross-site deployment would need `SameSite=None; Secure` and a
  re-examination of the CSRF strategy.
- Notification emails are sent through one SMTP transport with no queue; a
  prolonged outage drops those notifications, though the in-dashboard copy is
  still recorded.
