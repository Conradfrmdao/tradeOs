import type { FastifyRequest } from 'fastify';
import type { ActorType } from '@tradeos/db';
import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Append-only record of anything that changes money, access, or configuration
 * (PRD 32 / 43).
 *
 * Writes are fire-and-forget: an audit failure must never break the action it
 * describes, but it must be loud in the logs when it happens.
 */

export interface AuditInput {
  userId?: string | null;
  actorType: ActorType;
  action: string;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  request?: FastifyRequest;
}

export function audit(input: AuditInput): void {
  const { request, ...rest } = input;

  prisma.auditLog
    .create({
      data: {
        userId: rest.userId ?? null,
        actorType: rest.actorType,
        action: rest.action,
        entityType: rest.entityType ?? null,
        entityId: rest.entityId ?? null,
        ip: request ? clientIp(request) : null,
        userAgent: request ? String(request.headers['user-agent'] ?? '').slice(0, 300) : null,
        meta: (rest.meta ?? undefined) as never,
      },
    })
    .catch((err) => {
      logger.error({ err, action: rest.action }, 'failed to write audit log');
    });
}

export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.ip;
}

/** Action names, centralised so the admin log filter has a fixed vocabulary. */
export const AuditAction = {
  USER_SIGNUP: 'user.signup',
  USER_LOGIN: 'user.login',
  USER_LOGIN_FAILED: 'user.login_failed',
  USER_LOGOUT: 'user.logout',
  USER_EMAIL_VERIFIED: 'user.email_verified',
  USER_PASSWORD_RESET_REQUESTED: 'user.password_reset_requested',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_PROFILE_UPDATED: 'user.profile_updated',

  ACCOUNT_CREATED: 'account.created',
  ACCOUNT_UPDATED: 'account.updated',
  ACCOUNT_DELETED: 'account.deleted',
  ACCOUNT_PAIRING_ISSUED: 'account.pairing_issued',
  ACCOUNT_PAIRED: 'account.paired',
  ACCOUNT_UNPAIRED: 'account.unpaired',

  COPIER_UPDATED: 'copier.updated',
  COPIER_TOGGLED: 'copier.toggled',
  COPIER_GLOBAL_TOGGLED: 'copier.global_toggled',
  COPIER_EMERGENCY_STOP: 'copier.emergency_stop',
  CLOSE_ALL_REQUESTED: 'trades.close_all_requested',

  ADMIN_USER_DISABLED: 'admin.user_disabled',
  ADMIN_USER_ENABLED: 'admin.user_enabled',
  ADMIN_ACCOUNT_DISABLED: 'admin.account_disabled',
  ADMIN_ACCOUNT_ENABLED: 'admin.account_enabled',
} as const;
