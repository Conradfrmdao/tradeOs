import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@tradeos/db';
import {
  closeAllSchema,
  copierSettingsSchema,
  copyEventsQuerySchema,
  toggleCopyingSchema,
} from '@tradeos/shared';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { badRequest, notFound } from '../../lib/errors';
import { audit, AuditAction } from '../../lib/audit';
import { requireUser } from '../../plugins/auth';
import { realtime } from '../../lib/realtime';
import { serializeCopierSettings, serializeCopyEvent, serializeCopyTask } from '../../lib/serialize';
import { emitEvent } from '../../engine/copy-engine';
import { notify } from '../notifications/service';

const idParam = z.object({ id: z.string().uuid() });

export async function copierRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // GET /copier — every follower's configuration
  // -------------------------------------------------------------------------
  app.get('/copier', async (request, reply) => {
    const user = requireUser(request);

    const [settings, userSettings] = await Promise.all([
      prisma.copierSettings.findMany({
        where: { userId: user.id, followerAccount: { deletedAt: null } },
        include: { symbolMappings: true, followerAccount: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.userSettings.findUnique({ where: { userId: user.id } }),
    ]);

    return reply.send({
      copiers: settings.map(serializeCopierSettings),
      globalCopyingEnabled: userSettings?.copyingEnabled ?? true,
      emergencyStopAt: userSettings?.emergencyStopAt?.toISOString() ?? null,
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /copier/:id — per-follower risk settings (PRD 14)
  // -------------------------------------------------------------------------
  app.patch('/copier/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = copierSettingsSchema.parse(request.body);

    const existing = await prisma.copierSettings.findFirst({
      where: { id, userId: user.id },
      include: { followerAccount: true },
    });
    if (!existing) throw notFound('Copier settings not found');

    // Guard the combination, not just each field: a fixed lot of 0 or a
    // multiplier of 0 would queue unsendable orders on every master trade.
    const riskMode = body.riskMode ?? existing.riskMode;
    if (riskMode === 'FIXED_LOT' && (body.fixedLot ?? Number(existing.fixedLot)) <= 0) {
      throw badRequest('Fixed lot must be greater than zero', { fixedLot: 'Must be above 0' });
    }
    if (riskMode === 'LOT_MULTIPLIER' && (body.lotMultiplier ?? Number(existing.lotMultiplier)) <= 0) {
      throw badRequest('Lot multiplier must be greater than zero', {
        lotMultiplier: 'Must be above 0',
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.symbolMappings) {
        // Replace wholesale: the UI sends the complete list, and diffing rows
        // would leave orphans when a mapping is renamed.
        await tx.symbolMapping.deleteMany({ where: { copierSettingsId: id } });
        if (body.symbolMappings.length > 0) {
          await tx.symbolMapping.createMany({
            data: body.symbolMappings.map((m) => ({
              copierSettingsId: id,
              masterSymbol: m.masterSymbol,
              followerSymbol: m.followerSymbol,
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.copierSettings.update({
        where: { id },
        data: {
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.riskMode !== undefined ? { riskMode: body.riskMode } : {}),
          ...(body.lotMultiplier !== undefined
            ? { lotMultiplier: new Prisma.Decimal(body.lotMultiplier) }
            : {}),
          ...(body.fixedLot !== undefined
            ? { fixedLot: new Prisma.Decimal(body.fixedLot) }
            : {}),
          ...(body.minLot !== undefined
            ? { minLot: body.minLot == null ? null : new Prisma.Decimal(body.minLot) }
            : {}),
          ...(body.maxLot !== undefined
            ? { maxLot: body.maxLot == null ? null : new Prisma.Decimal(body.maxLot) }
            : {}),
          ...(body.copyStopLoss !== undefined ? { copyStopLoss: body.copyStopLoss } : {}),
          ...(body.copyTakeProfit !== undefined ? { copyTakeProfit: body.copyTakeProfit } : {}),
          ...(body.copyPendingOrders !== undefined
            ? { copyPendingOrders: body.copyPendingOrders }
            : {}),
          ...(body.reverseTrades !== undefined ? { reverseTrades: body.reverseTrades } : {}),
          ...(body.maxSlippagePoints !== undefined
            ? { maxSlippagePoints: body.maxSlippagePoints }
            : {}),
        },
        include: { symbolMappings: true, followerAccount: true },
      });
    });

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.COPIER_UPDATED,
      entityType: 'CopierSettings',
      entityId: id,
      request,
      meta: body as Record<string, unknown>,
    });

    if (body.enabled !== undefined && body.enabled !== existing.enabled) {
      await emitEvent({
        userId: user.id,
        eventType: 'COPIER_TOGGLED',
        status: 'INFO',
        message: `Copying ${body.enabled ? 'enabled' : 'disabled'} for ${existing.followerAccount.name}`,
        masterAccountId: existing.masterAccountId,
        followerAccountId: existing.followerAccountId,
      });

      realtime.publish(user.id, {
        type: 'copying.toggled',
        enabled: body.enabled,
        scope: 'follower',
        accountId: existing.followerAccountId,
      });
    }

    return reply.send({ copier: serializeCopierSettings(updated) });
  });

  // -------------------------------------------------------------------------
  // POST /copier/:id/toggle — the per-follower switch (PRD 26)
  // -------------------------------------------------------------------------
  app.post('/copier/:id/toggle', async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = toggleCopyingSchema.parse(request.body);

    const existing = await prisma.copierSettings.findFirst({
      where: { id, userId: user.id },
      include: { followerAccount: true },
    });
    if (!existing) throw notFound('Copier settings not found');

    const updated = await prisma.copierSettings.update({
      where: { id },
      data: { enabled: body.enabled },
      include: { symbolMappings: true, followerAccount: true },
    });

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.COPIER_TOGGLED,
      entityType: 'CopierSettings',
      entityId: id,
      request,
      meta: { enabled: body.enabled, follower: existing.followerAccount.name },
    });

    await emitEvent({
      userId: user.id,
      eventType: 'COPIER_TOGGLED',
      status: 'INFO',
      message: `Copying ${body.enabled ? 'ON' : 'OFF'} for ${existing.followerAccount.name}`,
      masterAccountId: existing.masterAccountId,
      followerAccountId: existing.followerAccountId,
    });

    realtime.publish(user.id, {
      type: 'copying.toggled',
      enabled: body.enabled,
      scope: 'follower',
      accountId: existing.followerAccountId,
    });

    return reply.send({ copier: serializeCopierSettings(updated) });
  });

  // -------------------------------------------------------------------------
  // POST /copier/global — the master switch (PRD 25)
  // -------------------------------------------------------------------------
  app.post('/copier/global', async (request, reply) => {
    const user = requireUser(request);
    const body = toggleCopyingSchema.parse(request.body);

    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, copyingEnabled: body.enabled },
      update: { copyingEnabled: body.enabled, emergencyStopAt: null },
    });

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.COPIER_GLOBAL_TOGGLED,
      entityType: 'UserSettings',
      entityId: user.id,
      request,
      meta: { enabled: body.enabled },
    });

    await emitEvent({
      userId: user.id,
      eventType: 'COPIER_TOGGLED',
      status: 'INFO',
      message: body.enabled
        ? 'Global copying turned ON — master trades will be copied again'
        : 'Global copying turned OFF — master trades will not be copied. Open positions are unchanged.',
    });

    realtime.publish(user.id, {
      type: 'copying.toggled',
      enabled: body.enabled,
      scope: 'global',
    });

    return reply.send({ copyingEnabled: body.enabled });
  });

  // -------------------------------------------------------------------------
  // POST /copier/emergency-stop (PRD 27)
  // -------------------------------------------------------------------------
  app.post('/copier/emergency-stop', async (request, reply) => {
    const user = requireUser(request);
    const now = new Date();

    // Stop at every level at once: the global switch, every follower switch,
    // and everything already queued. A user hitting this button expects
    // nothing further to reach a broker, not "nothing new".
    const [, , cancelled] = await prisma.$transaction([
      prisma.userSettings.upsert({
        where: { userId: user.id },
        create: { userId: user.id, copyingEnabled: false, emergencyStopAt: now },
        update: { copyingEnabled: false, emergencyStopAt: now },
      }),
      prisma.copierSettings.updateMany({
        where: { userId: user.id },
        data: { enabled: false },
      }),
      prisma.copyTask.updateMany({
        where: {
          masterAccount: { userId: user.id },
          status: { in: ['PENDING', 'DISPATCHED'] },
        },
        data: {
          status: 'SKIPPED',
          errorCode: 'TASK_EXPIRED',
          errorMessage: 'Cancelled by emergency stop',
          completedAt: now,
        },
      }),
    ]);

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.COPIER_EMERGENCY_STOP,
      entityType: 'UserSettings',
      entityId: user.id,
      request,
      meta: { cancelledTasks: cancelled.count },
    });

    await emitEvent({
      userId: user.id,
      eventType: 'EMERGENCY_STOP',
      status: 'FAILED',
      message:
        `EMERGENCY STOP — all copying disabled and ${cancelled.count} queued ` +
        `operation${cancelled.count === 1 ? '' : 's'} cancelled. Open positions are unchanged.`,
    });

    await notify(user.id, {
      type: 'copier.emergency_stop',
      severity: 'WARNING',
      title: 'Emergency stop activated',
      body:
        'All trade copying has been stopped and queued operations were cancelled. ' +
        'Existing open positions were not touched.',
      emailPreference: 'always',
    });

    realtime.publish(user.id, { type: 'copying.toggled', enabled: false, scope: 'global' });

    return reply.send({ ok: true, cancelledTasks: cancelled.count });
  });

  // -------------------------------------------------------------------------
  // POST /copier/close-all (PRD 28)
  // -------------------------------------------------------------------------
  app.post('/copier/close-all', async (request, reply) => {
    const user = requireUser(request);
    const body = closeAllSchema.parse(request.body);

    const accounts = await prisma.tradingAccount.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        ...(body.accountIds?.length ? { id: { in: body.accountIds } } : {}),
      },
      include: { positions: { where: { status: 'OPEN' } } },
    });

    if (accounts.length === 0) throw badRequest('No matching accounts');

    const expiresAt = new Date(Date.now() + config.COPY_TASK_TTL_SECONDS * 1000);
    let queued = 0;

    for (const account of accounts) {
      for (const position of account.positions) {
        // Reuses the normal task pipeline, so a manual close-all is dispatched,
        // retried, logged and deduplicated exactly like a copied close.
        const created = await prisma.copyTask
          .create({
            data: {
              masterAccountId: account.id,
              followerAccountId: account.id,
              masterPositionId: position.id,
              action: 'CLOSE',
              dedupeKey: `closeall:${position.id}`,
              payload: { symbol: position.symbol, targetTicket: position.ticket } as never,
              maxAttempts: config.COPY_MAX_ATTEMPTS,
              expiresAt,
            },
          })
          .catch(() => null); // already queued — the unique index says so

        if (created) queued++;
      }
    }

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.CLOSE_ALL_REQUESTED,
      entityType: 'User',
      entityId: user.id,
      request,
      meta: { accounts: accounts.map((a) => a.name), queued },
    });

    await emitEvent({
      userId: user.id,
      eventType: 'COPY_QUEUED',
      status: 'PENDING',
      message: `Close-all requested: ${queued} position${queued === 1 ? '' : 's'} queued to close across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`,
    });

    return reply.send({ ok: true, queued });
  });

  // -------------------------------------------------------------------------
  // GET /copier/events — the activity log (PRD 16)
  // -------------------------------------------------------------------------
  app.get('/copier/events', async (request, reply) => {
    const user = requireUser(request);
    const query = copyEventsQuerySchema.parse(request.query);

    const where = {
      userId: user.id,
      ...(query.accountId
        ? {
            OR: [
              { masterAccountId: query.accountId },
              { followerAccountId: query.accountId },
            ],
          }
        : {}),
      ...(query.status !== 'all' ? { status: query.status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.copyEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          masterAccount: { select: { name: true } },
          followerAccount: { select: { name: true } },
        },
      }),
      prisma.copyEvent.count({ where }),
    ]);

    return reply.send({
      items: items.map(serializeCopyEvent),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  });

  // -------------------------------------------------------------------------
  // GET /copier/tasks — in-flight and recent copy operations
  // -------------------------------------------------------------------------
  app.get('/copier/tasks', async (request, reply) => {
    const user = requireUser(request);

    const tasks = await prisma.copyTask.findMany({
      where: { masterAccount: { userId: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { followerAccount: { select: { name: true } } },
    });

    return reply.send({ tasks: tasks.map(serializeCopyTask) });
  });
}
