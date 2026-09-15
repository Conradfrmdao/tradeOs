import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAccountSchema, updateAccountSchema, type PairingDto } from '@tradeos/shared';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { badRequest, notFound } from '../../lib/errors';
import { audit, AuditAction } from '../../lib/audit';
import { requireUser, userTimezone } from '../../plugins/auth';
import { serializePosition } from '../../lib/serialize';
import { toNumber } from '../../lib/num';
import {
  assertAccountNotDuplicated,
  assertCanAddAccount,
  getAccountOrThrow,
  getPortfolio,
  issuePairingCode,
  listAccountDtos,
  removeAccount,
} from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // GET /accounts
  // -------------------------------------------------------------------------
  app.get('/accounts', async (request, reply) => {
    const user = requireUser(request);
    const accounts = await listAccountDtos(user.id, userTimezone(user));
    return reply.send({ accounts, maxAccounts: config.maxAccounts });
  });

  // -------------------------------------------------------------------------
  // GET /portfolio
  // -------------------------------------------------------------------------
  app.get('/portfolio', async (request, reply) => {
    const user = requireUser(request);
    const portfolio = await getPortfolio(user.id, userTimezone(user));
    return reply.send({ portfolio });
  });

  // -------------------------------------------------------------------------
  // POST /accounts
  // -------------------------------------------------------------------------
  app.post('/accounts', { preHandler: [app.requireVerified] }, async (request, reply) => {
    const user = requireUser(request);
    const body = createAccountSchema.parse(request.body);
    const server = body.server ?? null;

    await assertCanAddAccount(user.id, body.role);
    await assertAccountNotDuplicated(user.id, body.platform, body.accountNumber, server);

    // A follower is only useful once it is attached to a master, so the link is
    // created here rather than leaving the user to wire it up separately.
    const master =
      body.role === 'FOLLOWER'
        ? await prisma.tradingAccount.findFirst({
            where: { userId: user.id, role: 'MASTER', deletedAt: null },
            orderBy: { createdAt: 'asc' },
          })
        : null;

    if (body.role === 'FOLLOWER' && !master) {
      throw badRequest(
        'Connect a master account first — followers copy from a master, so there is nothing ' +
          'for this account to follow yet.',
      );
    }

    const account = await prisma.tradingAccount.create({
      data: {
        userId: user.id,
        name: body.name,
        platform: body.platform,
        role: body.role,
        broker: body.broker ?? null,
        accountNumber: body.accountNumber,
        server,
        currency: body.currency ?? 'USD',
        status: 'PENDING',
        ...(master
          ? {
              copierAsFollower: {
                create: {
                  userId: user.id,
                  masterAccountId: master.id,
                  // Starts off: the user chooses the risk rule before any trade
                  // reaches a brand new account.
                  enabled: false,
                },
              },
            }
          : {}),
      },
    });

    // Hand back a pairing code straight away — the next thing the user does is
    // always "connect the terminal".
    const { pairingCode, expiresAt } = await issuePairingCode(account.id);

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.ACCOUNT_CREATED,
      entityType: 'TradingAccount',
      entityId: account.id,
      request,
      meta: { platform: body.platform, role: body.role, accountNumber: body.accountNumber },
    });

    const pairing: PairingDto = {
      accountId: account.id,
      pairingCode,
      expiresAt: expiresAt.toISOString(),
      apiUrl: config.API_PUBLIC_URL,
    };

    return reply.status(201).send({ accountId: account.id, pairing });
  });

  // -------------------------------------------------------------------------
  // GET /accounts/:id
  // -------------------------------------------------------------------------
  app.get('/accounts/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const account = await prisma.tradingAccount.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      include: {
        agentToken: { select: { pairedAt: true, lastSeenAt: true, revokedAt: true } },
        copierAsFollower: { include: { symbolMappings: true } },
      },
    });
    if (!account) throw notFound('Trading account not found');

    const [positions, all] = await Promise.all([
      prisma.position.findMany({
        where: { accountId: id, status: 'OPEN' },
        orderBy: { openTime: 'desc' },
      }),
      listAccountDtos(user.id, userTimezone(user)),
    ]);

    const dto = all.find((a) => a.id === id);

    return reply.send({
      account: dto,
      detail: {
        credit: toNumber(account.credit),
        terminalBuild: account.terminalBuild,
        pairedAt: account.agentToken?.pairedAt?.toISOString() ?? null,
        agentLastSeenAt: account.agentToken?.lastSeenAt?.toISOString() ?? null,
      },
      positions: positions.map((p) => serializePosition(p, account)),
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /accounts/:id
  // -------------------------------------------------------------------------
  app.patch('/accounts/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);
    const body = updateAccountSchema.parse(request.body);

    const account = await getAccountOrThrow(user.id, id);

    const updated = await prisma.tradingAccount.update({
      where: { id: account.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.broker !== undefined ? { broker: body.broker } : {}),
        ...(body.enabled !== undefined
          ? {
              enabled: body.enabled,
              // Disabling parks the account; re-enabling hands it back to the
              // heartbeat monitor, which decides CONNECTED vs DISCONNECTED on
              // the next agent poll.
              status: body.enabled ? 'CONNECTING' : 'DISABLED',
            }
          : {}),
      },
    });

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.ACCOUNT_UPDATED,
      entityType: 'TradingAccount',
      entityId: account.id,
      request,
      meta: body as Record<string, unknown>,
    });

    const accounts = await listAccountDtos(user.id, userTimezone(user));
    return reply.send({ account: accounts.find((a) => a.id === updated.id) });
  });

  // -------------------------------------------------------------------------
  // DELETE /accounts/:id
  // -------------------------------------------------------------------------
  app.delete('/accounts/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const account = await getAccountOrThrow(user.id, id);
    await removeAccount(user.id, id);

    audit({
      userId: user.id,
      actorType: 'USER',
      action: AuditAction.ACCOUNT_DELETED,
      entityType: 'TradingAccount',
      entityId: id,
      request,
      meta: { name: account.name, role: account.role },
    });

    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /accounts/:id/pairing-code
  // -------------------------------------------------------------------------
  app.post(
    '/accounts/:id/pairing-code',
    {
      preHandler: [app.requireVerified],
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);

      const account = await getAccountOrThrow(user.id, id);
      const { pairingCode, expiresAt } = await issuePairingCode(account.id);

      audit({
        userId: user.id,
        actorType: 'USER',
        action: AuditAction.ACCOUNT_PAIRING_ISSUED,
        entityType: 'TradingAccount',
        entityId: account.id,
        request,
      });

      const pairing: PairingDto = {
        accountId: account.id,
        pairingCode,
        expiresAt: expiresAt.toISOString(),
        apiUrl: config.API_PUBLIC_URL,
      };

      return reply.send({ pairing });
    },
  );
}
