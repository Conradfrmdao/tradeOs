import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config';
import { logger } from './lib/logger';
import { errorHandler } from './lib/errors';
import { authPlugin } from './plugins/auth';
import { realtimeRoute } from './plugins/websocket-route';
import { authRoutes } from './modules/auth/routes';
import { accountRoutes } from './modules/accounts/routes';
import { copierRoutes } from './modules/copier/routes';
import { tradeRoutes } from './modules/trades/routes';
import { analyticsRoutes } from './modules/analytics/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { adminRoutes } from './modules/admin/routes';
import { agentRoutes } from './modules/agent/routes';
import { prisma } from './lib/prisma';

export type App = Awaited<ReturnType<typeof buildApp>>;

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    // Agents post full position snapshots; 1 MB is ample and bounds the damage
    // a malformed or hostile client can do.
    bodyLimit: 1_048_576,
    // Per-request logs are useful in development and pure noise in production,
    // where agents poll once a second per account.
    //
    // Fastify 5 deprecates this in favour of `logController`, but that option
    // requires the full LogController interface — a partial object widens the
    // instance type and breaks inference across every route. Revisit when
    // moving to Fastify 6, which removes this option.
    disableRequestLogging: config.isProduction,
  });

  app.setErrorHandler(errorHandler);

  await app.register(helmet, {
    // The API serves JSON, never HTML, so a restrictive CSP costs nothing.
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    // Session cookies only travel with credentials enabled, and credentials
    // require an explicit origin — never a wildcard.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Agents share the user's IP but authenticate individually; key on the
    // bearer token where present so one busy terminal cannot throttle another.
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      if (auth?.startsWith('Bearer ')) return `agent:${auth.slice(7, 40)}`;
      return request.ip;
    },
  });

  // A WebSocket needs a process that stays alive to hold it. In serverless the
  // dashboard falls back to polling, so registering the plugin would only add
  // a route that can never work.
  if (!config.isServerless) {
    await app.register(websocket, {
      options: { maxPayload: 65_536 },
    });
  }

  await app.register(authPlugin);

  // --- health --------------------------------------------------------------
  app.get('/health', async () => ({
    status: 'ok',
    time: new Date().toISOString(),
    // The dashboard reads this to decide between a WebSocket and polling,
    // rather than needing a separate build-time flag that can disagree.
    realtime: config.isServerless ? 'poll' : 'websocket',
    pollIntervalMs: config.AGENT_POLL_INTERVAL_MS,
  }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ready' });
    } catch (err) {
      logReadinessFailure(err);
      return reply.status(503).send({ status: 'unavailable', reason: 'database' });
    }
  });

  // --- routes ---------------------------------------------------------------
  if (!config.isServerless) {
    await app.register(realtimeRoute);
  }
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(copierRoutes);
  await app.register(tradeRoutes);
  await app.register(analyticsRoutes);
  await app.register(notificationRoutes);
  await app.register(adminRoutes);
  await app.register(agentRoutes);

  return app;
}

function logReadinessFailure(err: unknown): void {
  logger.error({ err }, 'readiness probe failed');
}
