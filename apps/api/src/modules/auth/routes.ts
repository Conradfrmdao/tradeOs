import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateProfileSchema,
  verifyEmailSchema,
  EMAIL_VERIFY_TTL_HOURS,
  PASSWORD_RESET_TTL_MINUTES,
} from '@tradeos/shared';
import { prisma } from '../../lib/prisma';
import {
  fakePasswordVerify,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../../lib/crypto';
import { badRequest, conflict, unauthorized } from '../../lib/errors';
import { audit, AuditAction } from '../../lib/audit';
import { serializeUser } from '../../lib/serialize';
import { createSession, destroySession, requireUser, revokeAllSessions } from '../../plugins/auth';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../lib/mailer';
import { isValidTimeZone } from '../../lib/time';
import { logger } from '../../lib/logger';

/** Wrong-password attempts before the account is briefly locked. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export async function authRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /auth/signup
  // -------------------------------------------------------------------------
  app.post(
    '/auth/signup',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = signupSchema.parse(request.body);

      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) {
        // The email is already an account; saying so is unavoidable here
        // because the user needs to know to sign in instead.
        throw conflict('An account with that email already exists', 'EMAIL_TAKEN');
      }

      const user = await prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash: await hashPassword(body.password),
          settings: { create: {} },
        },
        include: { settings: true },
      });

      const token = generateToken(32);
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          type: 'EMAIL_VERIFY',
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 3600_000),
        },
      });

      void sendVerificationEmail(user.email, user.name, token);

      audit({
        userId: user.id,
        actorType: 'USER',
        action: AuditAction.USER_SIGNUP,
        entityType: 'User',
        entityId: user.id,
        request,
      });

      // Signed in immediately; email verification gates connecting accounts,
      // not reaching the dashboard.
      await createSession(user.id, request, reply);

      return reply.status(201).send({ user: serializeUser(user) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------------
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);

      const user = await prisma.user.findUnique({
        where: { email: body.email },
        include: { settings: true },
      });

      if (!user) {
        // Spend the same time as a real verification so that a missing email
        // and a wrong password are indistinguishable from the outside.
        await fakePasswordVerify();
        throw unauthorized('Email or password is incorrect');
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
        throw unauthorized(
          `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        );
      }

      if (user.status === 'DISABLED') {
        throw unauthorized('This account has been disabled. Contact support.');
      }

      // A Clerk-managed account has no password here at all; it must sign in
      // through Clerk rather than being told its password is wrong.
      if (!user.passwordHash) {
        throw unauthorized('This account signs in with Clerk — use the sign-in page.');
      }

      const valid = await verifyPassword(body.password, user.passwordHash);

      if (!valid) {
        const failed = user.failedLoginCount + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed,
            lockedUntil:
              failed >= MAX_FAILED_LOGINS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                : null,
          },
        });

        audit({
          userId: user.id,
          actorType: 'USER',
          action: AuditAction.USER_LOGIN_FAILED,
          entityType: 'User',
          entityId: user.id,
          request,
          meta: { attempt: failed },
        });

        throw unauthorized('Email or password is incorrect');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      await createSession(user.id, request, reply);

      audit({
        userId: user.id,
        actorType: 'USER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: user.id,
        request,
      });

      return reply.send({ user: serializeUser(user) });
    },
  );

  // -------------------------------------------------------------------------
  // POST /auth/logout
  // -------------------------------------------------------------------------
  app.post('/auth/logout', async (request, reply) => {
    const userId = request.user?.id;
    await destroySession(request, reply);

    if (userId) {
      audit({
        userId,
        actorType: 'USER',
        action: AuditAction.USER_LOGOUT,
        entityType: 'User',
        entityId: userId,
        request,
      });
    }

    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /auth/me
  // -------------------------------------------------------------------------
  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    return reply.send({ user: serializeUser(requireUser(request)) });
  });

  // -------------------------------------------------------------------------
  // POST /auth/verify-email
  // -------------------------------------------------------------------------
  app.post('/auth/verify-email', async (request, reply) => {
    const body = verifyEmailSchema.parse(request.body);

    const token = await prisma.verificationToken.findUnique({
      where: { tokenHash: hashToken(body.token) },
      include: { user: { include: { settings: true } } },
    });

    if (!token || token.type !== 'EMAIL_VERIFY' || token.usedAt) {
      throw badRequest('That verification link is not valid or has already been used');
    }
    if (token.expiresAt.getTime() < Date.now()) {
      throw badRequest('That verification link has expired — request a new one');
    }

    const [, user] = await prisma.$transaction([
      prisma.verificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: token.userId },
        data: { emailVerified: true },
        include: { settings: true },
      }),
    ]);

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.USER_EMAIL_VERIFIED,
      entityType: 'User',
      entityId: user.id,
      request,
    });

    return reply.send({ user: serializeUser(user) });
  });

  // -------------------------------------------------------------------------
  // POST /auth/resend-verification
  // -------------------------------------------------------------------------
  app.post(
    '/auth/resend-verification',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (user.emailVerified) return reply.send({ ok: true, alreadyVerified: true });

      // Invalidate outstanding links so only the newest one works.
      await prisma.verificationToken.updateMany({
        where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
        data: { usedAt: new Date() },
      });

      const token = generateToken(32);
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          type: 'EMAIL_VERIFY',
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_HOURS * 3600_000),
        },
      });

      void sendVerificationEmail(user.email, user.name, token);
      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /auth/forgot-password
  // -------------------------------------------------------------------------
  app.post(
    '/auth/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = forgotPasswordSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });

      if (user && user.status === 'ACTIVE') {
        await prisma.verificationToken.updateMany({
          where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
          data: { usedAt: new Date() },
        });

        const token = generateToken(32);
        await prisma.verificationToken.create({
          data: {
            userId: user.id,
            type: 'PASSWORD_RESET',
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
          },
        });

        void sendPasswordResetEmail(user.email, user.name, token);

        audit({
          userId: user.id,
          actorType: 'USER',
          action: AuditAction.USER_PASSWORD_RESET_REQUESTED,
          entityType: 'User',
          entityId: user.id,
          request,
        });
      } else if (!user) {
        logger.info({ email: body.email }, 'password reset requested for unknown email');
      }

      // Always the same response. Revealing whether an address has an account
      // here would undo the enumeration defence on the login route.
      return reply.send({
        ok: true,
        message: 'If that email has an account, a reset link is on its way.',
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /auth/reset-password
  // -------------------------------------------------------------------------
  app.post(
    '/auth/reset-password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = resetPasswordSchema.parse(request.body);

      const token = await prisma.verificationToken.findUnique({
        where: { tokenHash: hashToken(body.token) },
      });

      if (!token || token.type !== 'PASSWORD_RESET' || token.usedAt) {
        throw badRequest('That reset link is not valid or has already been used');
      }
      if (token.expiresAt.getTime() < Date.now()) {
        throw badRequest('That reset link has expired — request a new one');
      }

      await prisma.$transaction([
        prisma.verificationToken.update({
          where: { id: token.id },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: token.userId },
          data: {
            passwordHash: await hashPassword(body.password),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        }),
      ]);

      // Whoever knew the old password is signed out everywhere. If the reset
      // was triggered by a compromise, leaving their sessions alive would
      // defeat the point of resetting.
      await revokeAllSessions(token.userId);

      audit({
        userId: token.userId,
        actorType: 'USER',
        action: AuditAction.USER_PASSWORD_RESET,
        entityType: 'User',
        entityId: token.userId,
        request,
      });

      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /auth/change-password
  // -------------------------------------------------------------------------
  app.post(
    '/auth/change-password',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const user = requireUser(request);
      const body = changePasswordSchema.parse(request.body);

      if (!user.passwordHash) {
        throw badRequest('Your password is managed by Clerk — change it from your account settings.');
      }

      if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw badRequest('Your current password is incorrect', {
          currentPassword: 'Incorrect password',
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.password) },
      });

      // Keep the current session; drop every other one.
      await revokeAllSessions(user.id, request.sessionId);

      audit({
        userId: user.id,
        actorType: 'USER',
        action: AuditAction.USER_PASSWORD_CHANGED,
        entityType: 'User',
        entityId: user.id,
        request,
      });

      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /auth/profile
  // -------------------------------------------------------------------------
  app.patch('/auth/profile', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = requireUser(request);
    const body = updateProfileSchema.parse(request.body);

    if (body.timezone && !isValidTimeZone(body.timezone)) {
      throw badRequest('That timezone is not recognised', { timezone: 'Unknown timezone' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.timezone
          ? {
              settings: {
                upsert: {
                  create: { timezone: body.timezone },
                  update: { timezone: body.timezone },
                },
              },
            }
          : {}),
      },
      include: { settings: true },
    });

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.USER_PROFILE_UPDATED,
      entityType: 'User',
      entityId: user.id,
      request,
    });

    return reply.send({ user: serializeUser(updated) });
  });
}
