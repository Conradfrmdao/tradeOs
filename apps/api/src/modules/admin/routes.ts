import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { requireUser } from '../../plugins/auth';
import { audit, AuditAction } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { toNumber } from '../../lib/num';
import { secondsSince } from '../../lib/time';
import { serializeCopyEvent, serializeCopyTask } from '../../lib/serialize';

const idParam = z.object({ id: z.string().uuid() });
const toggleSchema = z.object({ enabled: z.boolean() });

/**
 * Operator console (PRD 30).
 *
 * The hard rule: no route here ever selects `passwordHash` or
 * `encryptedCredentials`. An administrator can disable an account but can
 * never read the material that would let them use it.
 */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  // -------------------------------------------------------------------------
  // GET /admin/overview
  // -------------------------------------------------------------------------
  app.get('/admin/overview', async (_request, reply) => {
    const cutoff = new Date(Date.now() - config.AGENT_HEARTBEAT_TIMEOUT_SECONDS * 1000);
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [
      users,
      activeUsers,
      accounts,
      online,
      masters,
      followers,
      activeCopiers,
      failedCopies,
      pendingTasks,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.tradingAccount.count({ where: { deletedAt: null } }),
      prisma.tradingAccount.count({
        where: { deletedAt: null, status: 'CONNECTED', lastHeartbeatAt: { gte: cutoff } },
      }),
      prisma.tradingAccount.count({ where: { deletedAt: null, role: 'MASTER' } }),
      prisma.tradingAccount.count({ where: { deletedAt: null, role: 'FOLLOWER' } }),
      prisma.copierSettings.count({ where: { enabled: true } }),
      prisma.copyTask.count({ where: { status: 'FAILED', createdAt: { gte: dayAgo } } }),
      prisma.copyTask.count({ where: { status: { in: ['PENDING', 'DISPATCHED'] } } }),
    ]);

    return reply.send({
      users: { total: users, active: activeUsers, disabled: users - activeUsers },
      accounts: { total: accounts, online, offline: accounts - online, masters, followers },
      copier: { activeCopiers, failedCopiesLast24h: failedCopies, pendingTasks },
    });
  });

  // -------------------------------------------------------------------------
  // GET /admin/users
  // -------------------------------------------------------------------------
  app.get('/admin/users', async (request, reply) => {
    const query = z
      .object({
        search: z.string().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query);

    const where = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        // Explicit select, never `include` — this is the boundary that keeps
        // passwordHash out of an admin response.
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { accounts: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return reply.send({
      items: items.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: u.emailVerified,
        role: u.role,
        status: u.status,
        accountCount: u._count.accounts,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/users/:id/status
  // -------------------------------------------------------------------------
  app.post('/admin/users/:id/status', async (request, reply) => {
    const admin = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = toggleSchema.parse(request.body);

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!target) throw notFound('User not found');

    await prisma.user.update({
      where: { id },
      data: { status: body.enabled ? 'ACTIVE' : 'DISABLED' },
    });

    // Disabling must take effect now, not when the session happens to expire.
    if (!body.enabled) {
      await prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    audit({
      userId: admin.id,
      actorType: 'ADMIN',
      action: body.enabled ? AuditAction.ADMIN_USER_ENABLED : AuditAction.ADMIN_USER_DISABLED,
      entityType: 'User',
      entityId: id,
      request,
      meta: { targetEmail: target.email },
    });

    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /admin/accounts
  // -------------------------------------------------------------------------
  app.get('/admin/accounts', async (request, reply) => {
    const query = z
      .object({
        status: z.string().max(20).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query);

    const where = {
      deletedAt: null,
      ...(query.status && query.status !== 'all' ? { status: query.status as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.tradingAccount.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          platform: true,
          broker: true,
          accountNumber: true,
          server: true,
          role: true,
          status: true,
          enabled: true,
          balance: true,
          equity: true,
          currency: true,
          lastHeartbeatAt: true,
          lastError: true,
          agentVersion: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.tradingAccount.count({ where }),
    ]);

    return reply.send({
      items: items.map((a) => ({
        id: a.id,
        name: a.name,
        platform: a.platform,
        broker: a.broker,
        accountNumber: a.accountNumber,
        server: a.server,
        role: a.role,
        status: a.status,
        enabled: a.enabled,
        balance: toNumber(a.balance),
        equity: toNumber(a.equity),
        currency: a.currency,
        heartbeatAgeSeconds: secondsSince(a.lastHeartbeatAt),
        lastError: a.lastError,
        agentVersion: a.agentVersion,
        createdAt: a.createdAt.toISOString(),
        owner: a.user,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  });

  // -------------------------------------------------------------------------
  // POST /admin/accounts/:id/status
  // -------------------------------------------------------------------------
  app.post('/admin/accounts/:id/status', async (request, reply) => {
    const admin = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = toggleSchema.parse(request.body);

    const account = await prisma.tradingAccount.findFirst({ where: { id, deletedAt: null } });
    if (!account) throw notFound('Trading account not found');

    await prisma.tradingAccount.update({
      where: { id },
      data: {
        enabled: body.enabled,
        status: body.enabled ? 'CONNECTING' : 'DISABLED',
        lastError: body.enabled ? null : 'Disabled by an administrator',
      },
    });

    audit({
      userId: admin.id,
      actorType: 'ADMIN',
      action: body.enabled
        ? AuditAction.ADMIN_ACCOUNT_ENABLED
        : AuditAction.ADMIN_ACCOUNT_DISABLED,
      entityType: 'TradingAccount',
      entityId: id,
      request,
      meta: { accountName: account.name, ownerId: account.userId },
    });

    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /admin/copy-failures
  // -------------------------------------------------------------------------
  app.get('/admin/copy-failures', async (_request, reply) => {
    const tasks = await prisma.copyTask.findMany({
      where: { status: { in: ['FAILED', 'EXPIRED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { followerAccount: { select: { name: true } } },
    });

    // Which failure reasons dominate is the first thing an operator needs;
    // the individual rows are for chasing a specific one.
    const byCode = await prisma.copyTask.groupBy({
      by: ['errorCode'],
      where: { status: { in: ['FAILED', 'EXPIRED'] } },
      _count: { _all: true },
      orderBy: { _count: { errorCode: 'desc' } },
      take: 20,
    });

    return reply.send({
      tasks: tasks.map(serializeCopyTask),
      byCode: byCode.map((row) => ({ code: row.errorCode ?? 'UNKNOWN', count: row._count._all })),
    });
  });

  // -------------------------------------------------------------------------
  // GET /admin/logs — audit trail
  // -------------------------------------------------------------------------
  app.get('/admin/logs', async (request, reply) => {
    const query = z
      .object({
        action: z.string().max(60).optional(),
        userId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);

    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { email: true, name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return reply.send({
      items: items.map((log) => ({
        id: log.id,
        actorType: log.actorType,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        ip: log.ip,
        user: log.user,
        meta: log.meta,
        createdAt: log.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  });

  // -------------------------------------------------------------------------
  // GET /admin/events — system-wide copy event stream
  // -------------------------------------------------------------------------
  app.get('/admin/events', async (request, reply) => {
    const query = z
      .object({ pageSize: z.coerce.number().int().min(1).max(200).default(100) })
      .parse(request.query);

    const events = await prisma.copyEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: query.pageSize,
      include: {
        masterAccount: { select: { name: true } },
        followerAccount: { select: { name: true } },
      },
    });

    return reply.send({ items: events.map(serializeCopyEvent) });
  });
}
