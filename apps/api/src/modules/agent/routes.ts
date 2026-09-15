import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@tradeos/db';
import type { TradingAccount } from '@tradeos/db';
import {
  AGENT_PROTOCOL_VERSION,
  agentPairRequestSchema,
  agentSyncRequestSchema,
  type AgentPairResponse,
  type AgentSyncResponse,
} from '@tradeos/shared';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { realtime } from '../../lib/realtime';
import { badRequest, unauthorized } from '../../lib/errors';
import { generateToken, hashToken, normalizePairingCode } from '../../lib/crypto';
import { audit, AuditAction, clientIp } from '../../lib/audit';
import { listAccountDtos, getPortfolio } from '../accounts/service';
import { notify } from '../notifications/service';
import {
  buildCommandsForFollower,
  emitEvent,
  ingestFollowerState,
  ingestMasterState,
  watchSymbolsFor,
} from '../../engine/copy-engine';
import { applyCommandResults } from '../../engine/results';

/**
 * The MetaTrader-facing API.
 *
 * Authentication here is a bearer token issued at pairing — not a session
 * cookie — so these routes are unreachable from a browser carrying an ambient
 * login, and are exempt from CSRF for the same reason.
 */
export async function agentRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /agent/v1/pair
  // -------------------------------------------------------------------------
  app.post(
    '/agent/v1/pair',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '5 minutes' },
      },
    },
    async (request, reply) => {
      const body = agentPairRequestSchema.parse(request.body);
      const normalized = normalizePairingCode(body.pairingCode);

      const agentToken = await prisma.agentToken.findUnique({
        where: { pairingCodeHash: hashToken(normalized) },
        include: { account: true },
      });

      if (!agentToken || !agentToken.pairingExpiresAt) {
        throw unauthorized('That pairing code is not valid');
      }
      if (agentToken.pairingExpiresAt.getTime() < Date.now()) {
        throw unauthorized('That pairing code has expired — generate a new one in the dashboard');
      }
      if (agentToken.account.deletedAt) {
        throw unauthorized('That account has been removed');
      }

      // The code is bound to one account, so the terminal must be logged into
      // that account. Pairing the wrong terminal would silently mirror trades
      // from an account the user never connected.
      if (agentToken.account.accountNumber !== body.accountNumber) {
        logger.warn(
          { expected: agentToken.account.accountNumber, got: body.accountNumber },
          'pairing rejected: account number mismatch',
        );
        throw badRequest(
          `This code is for account ${agentToken.account.accountNumber}, but the terminal is ` +
            `logged into ${body.accountNumber}. Check which terminal you attached the agent to.`,
        );
      }
      if (agentToken.account.platform !== body.platform) {
        throw badRequest(
          `This code is for a ${agentToken.account.platform} account, but the agent reported ` +
            `${body.platform}.`,
        );
      }

      const token = generateToken(32);

      const [, account] = await prisma.$transaction([
        prisma.agentToken.update({
          where: { id: agentToken.id },
          data: {
            tokenHash: hashToken(token),
            // Burn the pairing code: it is single-use.
            pairingCodeHash: null,
            pairingExpiresAt: null,
            pairedAt: new Date(),
            revokedAt: null,
            lastSeenAt: new Date(),
            lastIp: clientIp(request),
          },
        }),
        prisma.tradingAccount.update({
          where: { id: agentToken.accountId },
          data: {
            status: 'CONNECTING',
            broker: body.broker ?? agentToken.account.broker,
            server: body.server ?? agentToken.account.server,
            currency: body.currency ?? agentToken.account.currency,
            leverage: body.leverage ?? agentToken.account.leverage,
            agentVersion: body.agentVersion ?? null,
            terminalBuild: body.terminalBuild ?? null,
            lastError: null,
          },
        }),
      ]);

      audit({
        userId: account.userId,
        actorType: 'AGENT',
        action: AuditAction.ACCOUNT_PAIRED,
        entityType: 'TradingAccount',
        entityId: account.id,
        request,
        meta: { platform: body.platform, agentVersion: body.agentVersion },
      });

      await pushAccountState(account.userId);

      const response: AgentPairResponse = {
        token,
        accountId: account.id,
        accountName: account.name,
        role: account.role,
        protocolVersion: AGENT_PROTOCOL_VERSION,
        pollIntervalMs: config.AGENT_POLL_INTERVAL_MS,
      };

      return reply.send(response);
    },
  );

  // -------------------------------------------------------------------------
  // POST /agent/v1/sync — the whole runtime loop
  // -------------------------------------------------------------------------
  app.post(
    '/agent/v1/sync',
    {
      config: {
        // Generous: a legitimate agent polls once a second, and several
        // accounts may share one outbound IP.
        rateLimit: { max: 400, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const account = await authenticateAgent(request);
      const body = agentSyncRequestSchema.parse(request.body);

      if (body.protocolVersion !== AGENT_PROTOCOL_VERSION) {
        throw badRequest(
          `Agent speaks protocol v${body.protocolVersion}, this server speaks ` +
            `v${AGENT_PROTOCOL_VERSION}. Update the TradeOS agent in MetaTrader.`,
        );
      }

      const now = new Date();
      const wasDisconnected =
        account.status === 'DISCONNECTED' ||
        account.status === 'ERROR' ||
        account.status === 'PENDING' ||
        account.status === 'CONNECTING';
      const isFirstSync = account.lastSyncAt == null;

      // --- 1. account snapshot ---------------------------------------------
      const updated = await prisma.tradingAccount.update({
        where: { id: account.id },
        data: {
          balance: new Prisma.Decimal(body.account.balance),
          equity: new Prisma.Decimal(body.account.equity),
          margin: new Prisma.Decimal(body.account.margin),
          freeMargin: new Prisma.Decimal(body.account.freeMargin),
          marginLevel: new Prisma.Decimal(body.account.marginLevel),
          credit: new Prisma.Decimal(body.account.credit),
          floatingPl: new Prisma.Decimal(body.account.equity - body.account.balance),
          currency: body.account.currency ?? account.currency,
          leverage: body.account.leverage ?? account.leverage,
          agentVersion: body.agentVersion ?? account.agentVersion,
          terminalBuild: body.terminalBuild ?? account.terminalBuild,
          lastHeartbeatAt: now,
          lastSyncAt: now,
          status: account.enabled ? 'CONNECTED' : 'DISABLED',
          lastError: body.account.tradeAllowed
            ? null
            : 'Automated trading is disabled in this terminal',
        },
      });

      if (wasDisconnected && account.enabled) {
        await onReconnected(updated);
      }

      // --- 2. results from previously issued commands -----------------------
      // Applied before new commands are built, so a retry can be re-queued and
      // handed back within the same round trip.
      const acknowledged =
        body.results.length > 0 ? await applyCommandResults(updated, body.results) : [];

      // --- 3. position diff --------------------------------------------------
      if (updated.role === 'MASTER') {
        await ingestMasterState(updated, body.positions, body.closed, isFirstSync);
      } else {
        await ingestFollowerState(updated, body.positions, body.closed);
      }

      // --- 4. equity curve sample -------------------------------------------
      await recordEquitySample(updated.id, body.account.balance, body.account.equity, now);

      // --- 5. commands to execute -------------------------------------------
      const copyingEnabled = await isCopyingEnabledFor(updated);
      const commands =
        updated.role === 'FOLLOWER' && copyingEnabled && updated.enabled
          ? await buildCommandsForFollower(updated)
          : [];

      const watchSymbols =
        updated.role === 'FOLLOWER' ? await watchSymbolsFor(updated) : [];

      // --- 6. push the new state to any open dashboard ----------------------
      await pushAccountState(updated.userId);

      const response: AgentSyncResponse = {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        serverTime: now.toISOString(),
        pollIntervalMs: config.AGENT_POLL_INTERVAL_MS,
        accountId: updated.id,
        role: updated.role,
        copyingEnabled,
        // Ask for a small overlap rather than exactly "since last sync", so a
        // deal closing during the request window is not missed.
        historyFrom: new Date(now.getTime() - 5 * 60_000).toISOString(),
        watchSymbols,
        commands,
        acknowledged,
      };

      return reply.send(response);
    },
  );

  // -------------------------------------------------------------------------
  // POST /agent/v1/unpair — agent removed from the chart
  // -------------------------------------------------------------------------
  app.post('/agent/v1/unpair', async (request, reply) => {
    const account = await authenticateAgent(request);

    await prisma.$transaction([
      prisma.agentToken.updateMany({
        where: { accountId: account.id },
        data: { revokedAt: new Date(), tokenHash: null },
      }),
      prisma.tradingAccount.update({
        where: { id: account.id },
        data: { status: 'DISCONNECTED', lastError: 'Agent was removed from the terminal' },
      }),
    ]);

    audit({
      userId: account.userId,
      actorType: 'AGENT',
      action: AuditAction.ACCOUNT_UNPAIRED,
      entityType: 'TradingAccount',
      entityId: account.id,
      request,
    });

    await pushAccountState(account.userId);
    return reply.send({ ok: true });
  });
}

// ===========================================================================
// Helpers
// ===========================================================================

async function authenticateAgent(request: FastifyRequest): Promise<TradingAccount> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Missing agent token');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) throw unauthorized('Missing agent token');

  const agentToken = await prisma.agentToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { account: true },
  });

  if (!agentToken || agentToken.revokedAt) {
    throw unauthorized('This agent has been disconnected — re-pair it from the dashboard');
  }
  if (agentToken.account.deletedAt) {
    throw unauthorized('That account has been removed');
  }

  // Cheap liveness touch; the authoritative heartbeat is written during sync.
  prisma.agentToken
    .update({
      where: { id: agentToken.id },
      data: { lastSeenAt: new Date(), lastIp: clientIp(request) },
    })
    .catch(() => undefined);

  return agentToken.account;
}

/**
 * Copying is on only when the global switch and the follower's own switch are
 * both on (PRD 25 / 26). Evaluated per sync so toggling takes effect on the
 * next poll — about a second — without restarting anything.
 */
async function isCopyingEnabledFor(account: TradingAccount): Promise<boolean> {
  const settings = await prisma.userSettings.findUnique({ where: { userId: account.userId } });
  if (settings && !settings.copyingEnabled) return false;

  if (account.role === 'MASTER') return true;

  const copier = await prisma.copierSettings.findUnique({
    where: { followerAccountId: account.id },
    select: { enabled: true },
  });
  return copier?.enabled ?? false;
}

async function onReconnected(account: TradingAccount): Promise<void> {
  await emitEvent({
    userId: account.userId,
    eventType: 'ACCOUNT_CONNECTED',
    status: 'SUCCESS',
    message: `${account.name} connected`,
    masterAccountId: account.role === 'MASTER' ? account.id : null,
    followerAccountId: account.role === 'FOLLOWER' ? account.id : null,
  });

  await notify(account.userId, {
    type: 'account.connected',
    severity: 'SUCCESS',
    title: `${account.name} is online`,
    body: `TradeOS is receiving live data from ${account.platform} account ${account.accountNumber}.`,
    emailPreference: 'notifyOnConnect',
    meta: { accountId: account.id },
  });
}

/**
 * One equity sample per minute per account.
 *
 * The timestamp is truncated to the minute and the row is upserted, so the
 * once-per-second sync rate collapses into a clean series without any
 * scheduling or locking — the unique index does the throttling.
 */
async function recordEquitySample(
  accountId: string,
  balance: number,
  equity: number,
  now: Date,
): Promise<void> {
  const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000);

  await prisma.equitySnapshot
    .upsert({
      where: { accountId_at: { accountId, at } },
      create: {
        accountId,
        at,
        balance: new Prisma.Decimal(balance),
        equity: new Prisma.Decimal(equity),
      },
      update: {
        balance: new Prisma.Decimal(balance),
        equity: new Prisma.Decimal(equity),
      },
    })
    .catch((err) => logger.warn({ err, accountId }, 'failed to record equity sample'));
}

/** Pushes refreshed account and portfolio state to the user's open dashboards. */
async function pushAccountState(userId: string): Promise<void> {
  if (!realtime.hasLocalListeners(userId)) return;

  try {
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    const timeZone = settings?.timezone ?? 'UTC';
    const [accounts, portfolio] = await Promise.all([
      listAccountDtos(userId, timeZone),
      getPortfolio(userId, timeZone),
    ]);
    realtime.publish(userId, { type: 'accounts', data: accounts });
    realtime.publish(userId, { type: 'portfolio', data: portfolio });
  } catch (err) {
    logger.warn({ err, userId }, 'failed to push realtime account state');
  }
}

