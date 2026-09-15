# ---------------------------------------------------------------------------
# TradeOS API
#
# This lives at the repository root, not next to the API source, because that
# is where every platform's Dockerfile auto-detection looks. Railway in
# particular falls back to its own Node builder when it cannot find one here,
# and then fails because a monorepo has no single start command.
#
# The build context is the whole repository either way: the image needs the
# shared packages and the Prisma schema, not just apps/api.
#
# Runs as a long-lived process, which is the whole reason it is not on a
# serverless platform: it holds the dashboard's WebSocket connections and runs
# the heartbeat supervisor that marks an account offline within seconds.
#
# Works as-is on Railway, Render, Fly.io, or any Docker host.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Prisma's query engine needs OpenSSL; the slim image does not ship it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Manifests first, so a dependency install is only redone when they change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --ignore-scripts

COPY packages/ packages/
COPY apps/api/ apps/api/

RUN npx prisma generate --schema packages/db/schema.prisma \
  && npm run build -w @tradeos/shared \
  && npm run build -w @tradeos/api

# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Production dependencies only — this drops Next.js, React and the toolchain,
# none of which the API process ever loads.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/db/generated packages/db/generated
COPY --from=builder /app/packages/db/schema.prisma packages/db/
COPY --from=builder /app/packages/db/migrations packages/db/migrations
# Both sources must be absolute: with --from, a relative source resolves from
# the root of that stage, not from its WORKDIR.
COPY --from=builder /app/packages/db/index.js /app/packages/db/index.d.ts packages/db/
COPY --from=builder /app/apps/api/dist apps/api/dist

# Run unprivileged. The node image already provides this user.
USER node

EXPOSE 4000
ENV API_PORT=4000 API_HOST=0.0.0.0

# The platform's own health check should hit /health/ready, which verifies the
# database is reachable rather than merely that the process is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
