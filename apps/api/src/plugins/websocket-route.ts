import type { FastifyInstance } from 'fastify';
import { REALTIME_PATH, type RealtimeMessage } from '@tradeos/shared';
import { realtime } from '../lib/realtime';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { listAccountDtos, getPortfolio } from '../modules/accounts/service';

/**
 * The dashboard's live feed (PRD 33).
 *
 * Authentication reuses the session cookie resolved by the auth plugin, so an
 * unauthenticated socket is closed before it is ever registered — there is no
 * separate token to leak into a URL.
 */
export async function realtimeRoute(app: FastifyInstance) {
  app.get(REALTIME_PATH, { websocket: true }, async (socket, request) => {
    const user = request.user;

    if (!user) {
      // 1008 = policy violation.
      socket.close(1008, 'Not authenticated');
      return;
    }

    const send = (message: RealtimeMessage) => {
      if (socket.readyState !== socket.OPEN) return;
      try {
        socket.send(JSON.stringify(message));
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'websocket send failed');
      }
    };

    const unsubscribe = realtime.subscribe(user.id, send);

    send({ type: 'hello', serverTime: new Date().toISOString(), userId: user.id });

    // Push an immediate snapshot so the client renders live data without
    // waiting for the next agent poll.
    void (async () => {
      try {
        const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
        const timeZone = settings?.timezone ?? 'UTC';
        const [accounts, portfolio] = await Promise.all([
          listAccountDtos(user.id, timeZone),
          getPortfolio(user.id, timeZone),
        ]);
        send({ type: 'accounts', data: accounts });
        send({ type: 'portfolio', data: portfolio });
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'failed to send initial websocket snapshot');
      }
    })();

    // Application-level keepalive. Proxies routinely drop idle sockets at 60s,
    // and a silent dashboard is indistinguishable from a broken one.
    const keepalive = setInterval(() => {
      send({ type: 'pong', serverTime: new Date().toISOString() });
    }, 25_000);

    socket.on('message', (raw: Buffer) => {
      try {
        const parsed = JSON.parse(raw.toString()) as { type?: string };
        if (parsed.type === 'ping') {
          send({ type: 'pong', serverTime: new Date().toISOString() });
        }
      } catch {
        // Malformed client frames are ignored rather than fatal.
      }
    });

    socket.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });

    socket.on('error', (err: Error) => {
      logger.warn({ err, userId: user.id }, 'websocket error');
      clearInterval(keepalive);
      unsubscribe();
    });
  });
}
