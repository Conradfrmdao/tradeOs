import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { FastifyRequest } from 'fastify';
import type { User, UserSettings } from '@tradeos/db';
import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Clerk-backed user identity.
 *
 * Clerk owns sign-in, sign-up, password reset and email verification. TradeOS
 * still keeps its own user row, because every trading account, trade, copy
 * event and audit entry hangs off it — a trader's history has to outlive
 * whichever auth provider sits in front of it.
 *
 * This deliberately does not touch the MetaTrader agents. They authenticate
 * with bearer tokens issued at pairing, which is why swapping the human auth
 * provider does not disturb a single connected terminal.
 */

let client: ClerkClient | null = null;

export function clerkEnabled(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

function clerk(): ClerkClient {
  if (!client) {
    client = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    });
  }
  return client;
}

export type SessionUser = User & { settings: UserSettings | null };

/**
 * Resolves the Clerk session on a request, if there is one.
 *
 * The dashboard and the API are served from the same origin, so Clerk's own
 * session cookie arrives here without the frontend having to forward a token
 * by hand.
 */
export async function resolveClerkUser(request: FastifyRequest): Promise<SessionUser | null> {
  if (!clerkEnabled()) return null;

  try {
    const url = new URL(request.url, `https://${request.headers.host ?? 'localhost'}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(','));
    }

    const requestState = await clerk().authenticateRequest(
      new Request(url.toString(), { method: request.method, headers }),
      { jwtKey: process.env.CLERK_JWT_KEY },
    );

    if (!requestState.isSignedIn) return null;

    const { userId } = requestState.toAuth();
    if (!userId) return null;

    return await linkClerkUser(userId);
  } catch (err) {
    // A failed verification is a signed-out request, not a server error.
    logger.debug({ err }, 'clerk session could not be verified');
    return null;
  }
}

/**
 * Finds or creates the local row for a Clerk user.
 *
 * Matching falls back to email so that an account which existed before Clerk
 * keeps its trading accounts and history when its owner signs in through Clerk
 * for the first time.
 */
export async function linkClerkUser(clerkUserId: string): Promise<SessionUser | null> {
  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
    include: { settings: true },
  });
  if (existing) return existing.status === 'DISABLED' ? null : existing;

  const profile = await clerk().users.getUser(clerkUserId);
  const email =
    profile.primaryEmailAddress?.emailAddress ??
    profile.emailAddresses[0]?.emailAddress;

  if (!email) {
    logger.warn({ clerkUserId }, 'clerk user has no email address');
    return null;
  }

  const name =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
    profile.username ||
    email.split('@')[0]!;

  // Clerk has already proven ownership of the address, so the local row is
  // created verified — there is no second verification step to complete.
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      name,
      clerkUserId,
      emailVerified: true,
      settings: { create: {} },
    },
    update: { clerkUserId, emailVerified: true },
    include: { settings: true },
  });

  logger.info({ userId: user.id, clerkUserId }, 'linked Clerk user');
  return user.status === 'DISABLED' ? null : user;
}
