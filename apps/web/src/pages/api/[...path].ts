import type { NextApiRequest, NextApiResponse } from 'next';
import { buildApp } from '@tradeos/api/dist/app';

/**
 * Runs the whole TradeOS API as a Vercel function.
 *
 * The Fastify app is reused exactly as written rather than rewritten as a set
 * of Next.js route handlers: the copy engine, the agent protocol and every
 * auth rule stay in one place, and the standalone server (`npm run dev:api`,
 * the Docker image) keeps working unchanged. Only the transport differs.
 *
 * This deliberately uses the Pages Router, which hands over Node's own
 * `req`/`res` objects. The App Router would give a Web `Request`, which would
 * have to be converted into a Node stream before Fastify could read it.
 *
 * Trade-offs that come with serverless, handled elsewhere:
 *  - no WebSocket; the dashboard polls instead (see config.isServerless)
 *  - no interval heartbeat; agent polls drive it (see sweepIfDue)
 */

export const config = {
  api: {
    // Fastify parses the body itself. Letting Next consume the stream first
    // would leave Fastify reading an already-drained request.
    bodyParser: false,
    externalResolver: true,
  },
  // The copy engine is not edge-compatible: it needs Prisma and node:crypto.
  runtime: 'nodejs',
  maxDuration: 30,
};

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;

/**
 * Built once per warm instance. Kept as the promise rather than the resolved
 * app so that concurrent invocations during a cold start share one build
 * instead of racing to create several.
 */
let appPromise: Promise<FastifyApp> | null = null;

async function getApp(): Promise<FastifyApp> {
  if (!appPromise) {
    appPromise = buildApp().then(async (app) => {
      await app.ready();
      return app;
    });

    // A failed build must not be cached forever — the next request should get
    // a fresh attempt rather than the same rejected promise.
    appPromise.catch(() => {
      appPromise = null;
    });
  }

  return appPromise;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let app: FastifyApp;

  try {
    app = await getApp();
  } catch (err) {
    // Almost always invalid configuration, which the API reports on stderr.
    console.error('TradeOS API failed to initialise', err);
    res.status(503).json({
      error: { code: 'API_UNAVAILABLE', message: 'The API is not configured correctly.' },
    });
    return;
  }

  // Routes are declared at the root ("/auth/login"), but Vercel serves this
  // handler under "/api". Strip the prefix so one set of route definitions
  // works both here and on a standalone server.
  if (req.url) {
    req.url = req.url.replace(/^\/api(?=\/|$)/, '') || '/';
  }

  app.server.emit('request', req, res);
}
