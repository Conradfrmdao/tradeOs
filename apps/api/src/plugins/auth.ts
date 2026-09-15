import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
} from '@tradeos/shared';
import type { User, UserSettings } from '@tradeos/db';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { generateToken, hashToken, safeEqual } from '../lib/crypto';
import { forbidden, unauthorized } from '../lib/errors';
import { clientIp } from '../lib/audit';

export type SessionUser = User & { settings: UserSettings | null };

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    sessionId?: string;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireVerified: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Opaque server-side sessions in an httpOnly cookie.
 *
 * Deliberately not JWTs: a session that cannot be revoked is the wrong
 * primitive for an application that can place trades. Here, revoking is a
 * single UPDATE and takes effect on the next request.
 */
export async function createSession(
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: clientIp(request),
      userAgent: String(request.headers['user-agent'] ?? '').slice(0, 300),
    },
  });

  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    signed: false,
  });

  // Double-submit CSRF companion. Readable by JS on purpose — its security
  // comes from the same-origin policy preventing another site from reading it,
  // not from secrecy against the page itself.
  reply.setCookie(CSRF_COOKIE_NAME, generateToken(16), {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (token) {
    await prisma.session
      .updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

/** Revokes every session for a user — used after a password change or reset. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}

async function resolveSession(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) return;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { settings: true } } },
  });

  if (!session) return;
  if (session.revokedAt) return;
  if (session.expiresAt.getTime() <= Date.now()) return;
  if (session.user.status === 'DISABLED') return;

  request.user = session.user;
  request.sessionId = session.id;

  // Throttled touch: one write per session per 5 minutes is enough to power a
  // "last active" display without a database write on every request.
  if (Date.now() - session.lastUsedAt.getTime() > 5 * 60_000) {
    prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyCsrf(request: FastifyRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  // Agent endpoints authenticate with a bearer token, not a cookie, so they
  // are not reachable by a browser riding an ambient session.
  if (request.url.startsWith('/agent/')) return;

  const cookie = request.cookies[CSRF_COOKIE_NAME];
  const header = request.headers[CSRF_HEADER_NAME];

  if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) {
    throw forbidden('Invalid or missing CSRF token — refresh the page and try again');
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  // Resolve the session for every request so route handlers can read
  // request.user optionally, without each one re-querying.
  app.addHook('onRequest', async (request) => {
    await resolveSession(request);
  });

  app.addHook('onRequest', async (request) => {
    if (request.user) verifyCsrf(request);
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
  });

  app.decorate('requireVerified', async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
    if (!request.user.emailVerified) {
      throw forbidden('Verify your email address before connecting trading accounts');
    }
  });

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
    if (request.user.role !== 'ADMIN') throw forbidden('Administrator access required');
  });
});

/** Narrowing helper for handlers that run behind `authenticate`. */
export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

export function userTimezone(user: SessionUser): string {
  return user.settings?.timezone ?? 'UTC';
}
