import crypto from 'node:crypto';
import { Prisma } from '@tradeos/db';
import type {
  CopierSettings,
  CopyAction,
  CopyEventStatus,
  CopyEventType,
  Position,
  SymbolMapping,
  TradingAccount,
} from '@tradeos/db';
import {
  buildDedupeKey,
  COPY_COMMENT_PREFIX,
  COPY_MAGIC_NUMBER,
  resolveCopyVolume,
  resolveDirection,
  resolveSymbol,
  type AgentClosedPosition,
  type AgentCommand,
  type AgentOpenPosition,
  type CopyErrorCode,
} from '@tradeos/shared';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { realtime } from '../lib/realtime';
import { toNum, toNumber } from '../lib/num';
import { serializeCopyEvent, serializePosition } from '../lib/serialize';
import { notify } from '../modules/notifications/service';

type CopierWithMappings = CopierSettings & {
  symbolMappings: SymbolMapping[];
  followerAccount: TradingAccount;
};

/** Prices equal within this fraction are treated as unchanged (float noise). */
const PRICE_EPSILON = 1e-9;

// ===========================================================================
// Event logging
// ===========================================================================

interface EmitEventInput {
  userId: string;
  eventType: CopyEventType;
  status?: CopyEventStatus;
  message: string;
  masterAccountId?: string | null;
  followerAccountId?: string | null;
  copyTaskId?: string | null;
  masterPositionId?: string | null;
  followerPositionId?: string | null;
  errorCode?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Writes one line of the copy activity log (PRD 16 / 43) and pushes it to any
 * dashboard watching. Failures are swallowed: losing a log line must never
 * abort the trade operation it describes.
 */
export async function emitEvent(input: EmitEventInput): Promise<void> {
  try {
    const event = await prisma.copyEvent.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        status: input.status ?? 'INFO',
        message: input.message,
        masterAccountId: input.masterAccountId ?? null,
        followerAccountId: input.followerAccountId ?? null,
        copyTaskId: input.copyTaskId ?? null,
        masterPositionId: input.masterPositionId ?? null,
        followerPositionId: input.followerPositionId ?? null,
        errorCode: input.errorCode ?? null,
        meta: (input.meta ?? undefined) as never,
      },
      include: {
        masterAccount: { select: { name: true } },
        followerAccount: { select: { name: true } },
      },
    });

    realtime.publish(input.userId, { type: 'copy.event', data: serializeCopyEvent(event) });
  } catch (err) {
    logger.error({ err, eventType: input.eventType }, 'failed to write copy event');
  }
}

// ===========================================================================
// Master ingestion
// ===========================================================================

export interface MasterIngestResult {
  opened: number;
  closed: number;
  modified: number;
  tasksCreated: number;
}

/**
 * Diffs the master terminal's reported state against what we last saw, and
 * turns each genuine change into copy tasks.
 *
 * The agent always sends a *full snapshot* of open positions rather than a
 * delta, so a dropped poll, a terminal restart, or a server restart cannot
 * lose an event: whatever the next snapshot says is reconciled against the
 * database, and the database is the only memory the engine relies on.
 */
export async function ingestMasterState(
  account: TradingAccount,
  reported: AgentOpenPosition[],
  closedReports: AgentClosedPosition[],
  isFirstSync: boolean,
): Promise<MasterIngestResult> {
  const result: MasterIngestResult = { opened: 0, closed: 0, modified: 0, tasksCreated: 0 };

  const existing = await prisma.position.findMany({
    where: { accountId: account.id, status: 'OPEN' },
  });
  const existingByTicket = new Map(existing.map((p) => [p.ticket, p]));
  const reportedByTicket = new Map(reported.map((p) => [p.ticket, p]));

  const copiers = isFirstSync ? [] : await loadEnabledCopiers(account);

  // --- opened & modified ---------------------------------------------------
  for (const incoming of reported) {
    const prior = existingByTicket.get(incoming.ticket);

    if (!prior) {
      const position = await upsertPosition(account.id, incoming);
      result.opened++;

      if (isFirstSync) {
        // A master that has just connected may already hold positions. Copying
        // them would fire a burst of trades the user never asked for, at prices
        // that no longer relate to the master's entry — so the first snapshot is
        // recorded as a baseline and only later changes are copied.
        await emitEvent({
          userId: account.userId,
          eventType: 'MASTER_OPEN',
          status: 'SKIPPED',
          message:
            `Existing position ${incoming.symbol} ${incoming.direction} ` +
            `${incoming.volume} recorded but not copied (already open when the master connected)`,
          masterAccountId: account.id,
          masterPositionId: position.id,
          meta: { reason: 'PRE_EXISTING_AT_CONNECT', ticket: incoming.ticket },
        });
        continue;
      }

      await emitEvent({
        userId: account.userId,
        eventType: 'MASTER_OPEN',
        status: 'INFO',
        message: `Master opened ${incoming.direction} ${incoming.symbol} ${incoming.volume} lot`,
        masterAccountId: account.id,
        masterPositionId: position.id,
        meta: { ticket: incoming.ticket, openPrice: incoming.openPrice },
      });

      result.tasksCreated += await queueForFollowers(account, position, copiers, 'OPEN');
      continue;
    }

    // Already known — refresh the live figures, then look for a stop change.
    const stopsChanged =
      !priceEquals(toNumber(prior.stopLoss), incoming.stopLoss ?? null) ||
      !priceEquals(toNumber(prior.takeProfit), incoming.takeProfit ?? null);

    const position = await upsertPosition(account.id, incoming);

    if (stopsChanged && !isFirstSync) {
      result.modified++;
      await emitEvent({
        userId: account.userId,
        eventType: 'MASTER_MODIFY',
        status: 'INFO',
        message:
          `Master changed stops on ${incoming.symbol}: ` +
          `SL ${fmt(incoming.stopLoss)} / TP ${fmt(incoming.takeProfit)}`,
        masterAccountId: account.id,
        masterPositionId: position.id,
      });
      result.tasksCreated += await queueForFollowers(account, position, copiers, 'MODIFY');
    }
  }

  // --- closed --------------------------------------------------------------
  const closedByTicket = new Map(closedReports.map((c) => [c.ticket, c]));

  for (const prior of existing) {
    if (reportedByTicket.has(prior.ticket)) continue;

    const report = closedByTicket.get(prior.ticket);
    const closed = await closePosition(prior, report);
    result.closed++;

    await emitEvent({
      userId: account.userId,
      eventType: 'MASTER_CLOSE',
      status: 'INFO',
      message:
        `Master closed ${prior.direction} ${prior.symbol} ${toNum(prior.volume)} lot ` +
        `(${toNum(closed.netProfit) >= 0 ? '+' : ''}${toNum(closed.netProfit).toFixed(2)})`,
      masterAccountId: account.id,
      masterPositionId: prior.id,
      meta: { ticket: prior.ticket },
    });

    // A close is queued even for positions that were never copied — the task
    // will simply find nothing to close and resolve as SKIPPED, which is
    // cheaper than tracking "was this copied" separately and getting it wrong.
    if (!isFirstSync) {
      result.tasksCreated += await queueForFollowers(account, closed, copiers, 'CLOSE');
    }

    realtime.publish(account.userId, {
      type: 'position.closed',
      data: serializePosition(closed, account),
    });
  }

  // Closed deals the master reported that we never saw open (history backfill).
  // Recorded for statistics; never copied.
  for (const report of closedReports) {
    if (existingByTicket.has(report.ticket)) continue;
    await recordHistoricalClose(account.id, report);
  }

  return result;
}

async function loadEnabledCopiers(master: TradingAccount): Promise<CopierWithMappings[]> {
  const settings = await prisma.userSettings.findUnique({ where: { userId: master.userId } });

  // The global kill switch (PRD 25 / 27) short-circuits before any task is
  // created, so turning copying off stops new trades at the source rather than
  // relying on every downstream check.
  if (settings && !settings.copyingEnabled) return [];

  return prisma.copierSettings.findMany({
    where: {
      masterAccountId: master.id,
      enabled: true,
      followerAccount: { deletedAt: null, enabled: true, status: { not: 'DISABLED' } },
    },
    include: { symbolMappings: true, followerAccount: true },
  });
}

// ===========================================================================
// Task creation — the idempotency boundary (PRD 42)
// ===========================================================================

/**
 * Creates at most one task per (follower, master event).
 *
 * Idempotency is enforced by the database, not by application logic: the
 * `(followerAccountId, dedupeKey)` unique index plus `skipDuplicates` compiles
 * to INSERT ... ON CONFLICT DO NOTHING. Two API instances racing on the same
 * master event, a retried request, or a replayed snapshot all converge on one
 * row. There is no read-then-write window to lose.
 */
async function queueForFollowers(
  master: TradingAccount,
  masterPosition: Position,
  copiers: CopierWithMappings[],
  action: Extract<CopyAction, 'OPEN' | 'CLOSE' | 'MODIFY'>,
): Promise<number> {
  if (copiers.length === 0) return 0;

  const expiresAt = new Date(Date.now() + config.COPY_TASK_TTL_SECONDS * 1000);
  const rows: Prisma.CopyTaskCreateManyInput[] = [];
  const intended = new Map<string, { copier: CopierWithMappings; taskId: string }>();

  for (const copier of copiers) {
    const plan = planCopy(masterPosition, copier, action);

    if ('skip' in plan) {
      await emitEvent({
        userId: master.userId,
        eventType: 'COPY_SKIPPED',
        status: 'SKIPPED',
        message: `${copier.followerAccount.name}: ${plan.skip}`,
        masterAccountId: master.id,
        followerAccountId: copier.followerAccountId,
        masterPositionId: masterPosition.id,
        errorCode: plan.code ?? null,
      });
      continue;
    }

    const dedupeKey = buildDedupeKey(action, masterPosition.id, {
      stopLoss: toNumber(masterPosition.stopLoss),
      takeProfit: toNumber(masterPosition.takeProfit),
    });

    const taskId = crypto.randomUUID();
    intended.set(dedupeKey, { copier, taskId });

    rows.push({
      id: taskId,
      masterAccountId: master.id,
      followerAccountId: copier.followerAccountId,
      masterPositionId: masterPosition.id,
      action,
      dedupeKey,
      status: 'PENDING',
      maxAttempts: config.COPY_MAX_ATTEMPTS,
      payload: plan.payload as never,
      expiresAt,
    });
  }

  if (rows.length === 0) return 0;

  await prisma.copyTask.createMany({ data: rows, skipDuplicates: true });

  // Read back to learn which rows this call actually inserted: a task whose
  // stored id matches the id we generated is ours, anything else was already
  // there and must not be logged or counted twice.
  const stored = await prisma.copyTask.findMany({
    where: {
      masterPositionId: masterPosition.id,
      action,
      followerAccountId: { in: rows.map((r) => r.followerAccountId) },
    },
    select: { id: true, dedupeKey: true, followerAccountId: true },
  });

  let created = 0;

  for (const task of stored) {
    const planned = intended.get(task.dedupeKey);
    if (!planned || planned.taskId !== task.id) continue; // pre-existing — ignore

    created++;
    const payload = rows.find((r) => r.id === task.id)?.payload as
      | { symbol?: string; volume?: number; direction?: string }
      | undefined;

    await emitEvent({
      userId: master.userId,
      eventType: 'COPY_QUEUED',
      status: 'PENDING',
      message:
        action === 'OPEN'
          ? `${planned.copier.followerAccount.name}: queued ${payload?.direction} ` +
            `${payload?.symbol} ${payload?.volume} lot`
          : `${planned.copier.followerAccount.name}: queued ${action.toLowerCase()} of ` +
            `${masterPosition.symbol}`,
      masterAccountId: master.id,
      followerAccountId: task.followerAccountId,
      copyTaskId: task.id,
      masterPositionId: masterPosition.id,
    });
  }

  return created;
}

type CopyPlan =
  | { payload: Record<string, unknown> }
  | { skip: string; code?: CopyErrorCode };

/** Applies symbol mapping, risk sizing and direction rules to one follower. */
function planCopy(
  masterPosition: Position,
  copier: CopierWithMappings,
  action: 'OPEN' | 'CLOSE' | 'MODIFY',
): CopyPlan {
  const symbol = resolveSymbol(masterPosition.symbol, copier.symbolMappings);

  if (action === 'CLOSE') {
    return { payload: { symbol, masterPositionId: masterPosition.id } };
  }

  if (action === 'MODIFY') {
    if (!copier.copyStopLoss && !copier.copyTakeProfit) {
      return { skip: 'stop-loss and take-profit copying are both off' };
    }
    return {
      payload: {
        symbol,
        masterPositionId: masterPosition.id,
        stopLoss: copier.copyStopLoss ? toNumber(masterPosition.stopLoss) : null,
        takeProfit: copier.copyTakeProfit ? toNumber(masterPosition.takeProfit) : null,
      },
    };
  }

  const volume = resolveCopyVolume(
    toNum(masterPosition.volume),
    {
      riskMode: copier.riskMode,
      lotMultiplier: toNum(copier.lotMultiplier, 1),
      fixedLot: toNum(copier.fixedLot, 0.1),
      minLot: toNumber(copier.minLot),
      maxLot: toNumber(copier.maxLot),
    },
    // Broker-specific volume limits are applied by the EA, which has the
    // authoritative symbol spec; the server applies the user's own guards.
    {},
  );

  if (volume.rejected) {
    return { skip: volume.note ?? 'computed volume is not tradable', code: 'INVALID_VOLUME' };
  }

  const direction = resolveDirection(masterPosition.direction, copier.reverseTrades);

  return {
    payload: {
      symbol,
      direction,
      volume: volume.volume,
      stopLoss: copier.copyStopLoss ? toNumber(masterPosition.stopLoss) : null,
      takeProfit: copier.copyTakeProfit ? toNumber(masterPosition.takeProfit) : null,
      slippagePoints: copier.maxSlippagePoints,
      magic: COPY_MAGIC_NUMBER,
      masterPositionId: masterPosition.id,
      masterTicket: masterPosition.ticket,
      reversed: copier.reverseTrades,
      sizing: { mode: copier.riskMode, requested: volume.requested, applied: volume.code },
    },
  };
}

// ===========================================================================
// Dispatch
// ===========================================================================

/**
 * Hands a follower the commands waiting for it.
 *
 * Tasks are marked DISPATCHED in the same statement that selects them, so two
 * concurrent polls from the same agent cannot both receive the same command.
 */
export async function buildCommandsForFollower(account: TradingAccount): Promise<AgentCommand[]> {
  const now = new Date();

  await expireTasks(account.id, now);

  const pending = await prisma.copyTask.findMany({
    where: {
      followerAccountId: account.id,
      status: 'PENDING',
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'asc' },
    take: 25,
    include: { masterPosition: { select: { id: true, ticket: true, symbol: true } } },
  });

  if (pending.length === 0) return [];

  const commands: AgentCommand[] = [];
  const dispatchedIds: string[] = [];

  for (const task of pending) {
    const payload = (task.payload ?? {}) as Record<string, unknown>;

    // CLOSE and MODIFY act on the follower's own ticket, which only exists if
    // the matching OPEN succeeded. Resolve it now rather than storing it at
    // queue time, when it was not yet known.
    let targetTicket: string | undefined;

    if (task.action !== 'OPEN') {
      targetTicket = await findFollowerTicket(account.id, task.masterPositionId);

      if (!targetTicket) {
        await settleTask(task.id, {
          status: 'SKIPPED',
          errorCode: 'POSITION_NOT_FOUND',
          errorMessage: 'No corresponding position on this follower',
        });
        await emitEvent({
          userId: account.userId,
          eventType: 'COPY_SKIPPED',
          status: 'SKIPPED',
          message: `${account.name}: nothing to ${task.action.toLowerCase()} — the master trade was never copied here`,
          masterAccountId: task.masterAccountId,
          followerAccountId: account.id,
          copyTaskId: task.id,
          errorCode: 'POSITION_NOT_FOUND',
        });
        continue;
      }
    }

    commands.push({
      id: task.id,
      action: task.action,
      symbol: String(payload.symbol ?? task.masterPosition?.symbol ?? ''),
      direction: payload.direction as 'BUY' | 'SELL' | undefined,
      volume: typeof payload.volume === 'number' ? payload.volume : undefined,
      stopLoss: (payload.stopLoss as number | null) ?? null,
      takeProfit: (payload.takeProfit as number | null) ?? null,
      slippagePoints: typeof payload.slippagePoints === 'number' ? payload.slippagePoints : 20,
      magic: typeof payload.magic === 'number' ? payload.magic : COPY_MAGIC_NUMBER,
      // The task id travels in the order comment so a position can be traced
      // back to the instruction that created it from inside the terminal.
      comment: `${COPY_COMMENT_PREFIX}:${task.id.slice(0, 8)}`,
      targetTicket,
      expiresAt: task.expiresAt.toISOString(),
    });

    dispatchedIds.push(task.id);
  }

  if (dispatchedIds.length > 0) {
    await prisma.copyTask.updateMany({
      where: { id: { in: dispatchedIds } },
      data: { status: 'DISPATCHED', dispatchedAt: now, attempts: { increment: 1 } },
    });

    for (const task of pending) {
      if (!dispatchedIds.includes(task.id)) continue;
      await emitEvent({
        userId: account.userId,
        eventType: 'COPY_DISPATCHED',
        status: 'PROCESSING',
        message: `${account.name}: order submitted`,
        masterAccountId: task.masterAccountId,
        followerAccountId: account.id,
        copyTaskId: task.id,
        masterPositionId: task.masterPositionId,
      });
    }
  }

  return commands;
}

async function findFollowerTicket(
  followerAccountId: string,
  masterPositionId: string | null,
): Promise<string | undefined> {
  if (!masterPositionId) return undefined;

  const openTask = await prisma.copyTask.findFirst({
    where: {
      followerAccountId,
      masterPositionId,
      action: 'OPEN',
      status: 'SUCCESS',
      followerTicket: { not: null },
    },
    select: { followerTicket: true },
  });

  return openTask?.followerTicket ?? undefined;
}

/**
 * Abandons tasks that outlived their usefulness.
 *
 * A copy that arrives a minute late is not a copy, it is a new trade at a
 * price the user never chose — so expiry is a deliberate outcome, logged as
 * such, rather than something to retry.
 */
export async function expireTasks(followerAccountId: string | null, now = new Date()): Promise<void> {
  const stale = await prisma.copyTask.findMany({
    where: {
      ...(followerAccountId ? { followerAccountId } : {}),
      status: { in: ['PENDING', 'DISPATCHED'] },
      expiresAt: { lte: now },
    },
    include: { followerAccount: { select: { name: true, userId: true } } },
    take: 100,
  });

  for (const task of stale) {
    await settleTask(task.id, {
      status: 'EXPIRED',
      errorCode: 'TASK_EXPIRED',
      errorMessage: `Not executed within ${config.COPY_TASK_TTL_SECONDS}s`,
    });

    await emitEvent({
      userId: task.followerAccount.userId,
      eventType: 'COPY_EXPIRED',
      status: 'FAILED',
      message:
        `${task.followerAccount.name}: ${task.action.toLowerCase()} expired after ` +
        `${config.COPY_TASK_TTL_SECONDS}s without execution`,
      masterAccountId: task.masterAccountId,
      followerAccountId: task.followerAccountId,
      copyTaskId: task.id,
      errorCode: 'TASK_EXPIRED',
    });

    await notify(task.followerAccount.userId, {
      type: 'copy.expired',
      severity: 'WARNING',
      title: 'A copy did not execute in time',
      body: `${task.followerAccount.name}: ${task.action.toLowerCase()} expired before the terminal executed it.`,
      emailPreference: 'notifyOnCopyFail',
    });
  }
}

async function settleTask(
  id: string,
  data: { status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'EXPIRED'; errorCode?: string; errorMessage?: string; followerTicket?: string },
): Promise<void> {
  await prisma.copyTask.update({
    where: { id },
    data: {
      status: data.status,
      errorCode: data.errorCode ?? null,
      errorMessage: data.errorMessage ?? null,
      followerTicket: data.followerTicket ?? undefined,
      completedAt: new Date(),
    },
  });
}

export { settleTask };

// ===========================================================================
// Position persistence
// ===========================================================================

export async function upsertPosition(
  accountId: string,
  incoming: AgentOpenPosition,
  masterPositionId?: string | null,
): Promise<Position> {
  const netProfit = incoming.profit + incoming.swap + incoming.commission;

  const common = {
    positionId: incoming.positionId ?? null,
    magic: incoming.magic ?? null,
    symbol: incoming.symbol,
    direction: incoming.direction,
    volume: new Prisma.Decimal(incoming.volume),
    openPrice: new Prisma.Decimal(incoming.openPrice),
    currentPrice: incoming.currentPrice != null ? new Prisma.Decimal(incoming.currentPrice) : null,
    stopLoss: incoming.stopLoss ? new Prisma.Decimal(incoming.stopLoss) : null,
    takeProfit: incoming.takeProfit ? new Prisma.Decimal(incoming.takeProfit) : null,
    profit: new Prisma.Decimal(incoming.profit),
    swap: new Prisma.Decimal(incoming.swap),
    commission: new Prisma.Decimal(incoming.commission),
    netProfit: new Prisma.Decimal(netProfit),
    openTime: new Date(incoming.openTime),
    comment: incoming.comment ?? null,
    status: 'OPEN' as const,
  };

  return prisma.position.upsert({
    where: { accountId_ticket: { accountId, ticket: incoming.ticket } },
    create: {
      accountId,
      ticket: incoming.ticket,
      ...common,
      ...(masterPositionId ? { masterPositionId } : {}),
    },
    update: {
      ...common,
      // Never overwrite an established lineage with null on a later sync.
      ...(masterPositionId ? { masterPositionId } : {}),
    },
  });
}

async function closePosition(
  prior: Position,
  report: AgentClosedPosition | undefined,
): Promise<Position> {
  const profit = report?.profit ?? toNum(prior.profit);
  const swap = report?.swap ?? toNum(prior.swap);
  const commission = report?.commission ?? toNum(prior.commission);

  return prisma.position.update({
    where: { id: prior.id },
    data: {
      status: 'CLOSED',
      closePrice: report?.closePrice
        ? new Prisma.Decimal(report.closePrice)
        : prior.currentPrice,
      closeTime: report?.closeTime ? new Date(report.closeTime) : new Date(),
      profit: new Prisma.Decimal(profit),
      swap: new Prisma.Decimal(swap),
      commission: new Prisma.Decimal(commission),
      netProfit: new Prisma.Decimal(profit + swap + commission),
    },
  });
}

/** Stores a closed deal we never observed open — history backfill only. */
async function recordHistoricalClose(
  accountId: string,
  report: AgentClosedPosition,
): Promise<void> {
  const netProfit = report.profit + report.swap + report.commission;

  await prisma.position.upsert({
    where: { accountId_ticket: { accountId, ticket: report.ticket } },
    create: {
      accountId,
      ticket: report.ticket,
      positionId: report.positionId ?? null,
      magic: report.magic ?? null,
      symbol: report.symbol,
      direction: report.direction,
      volume: new Prisma.Decimal(report.volume),
      openPrice: new Prisma.Decimal(report.openPrice),
      closePrice: new Prisma.Decimal(report.closePrice),
      stopLoss: report.stopLoss ? new Prisma.Decimal(report.stopLoss) : null,
      takeProfit: report.takeProfit ? new Prisma.Decimal(report.takeProfit) : null,
      profit: new Prisma.Decimal(report.profit),
      swap: new Prisma.Decimal(report.swap),
      commission: new Prisma.Decimal(report.commission),
      netProfit: new Prisma.Decimal(netProfit),
      openTime: new Date(report.openTime),
      closeTime: new Date(report.closeTime),
      status: 'CLOSED',
      comment: report.comment ?? null,
    },
    update: {
      status: 'CLOSED',
      closePrice: new Prisma.Decimal(report.closePrice),
      closeTime: new Date(report.closeTime),
      profit: new Prisma.Decimal(report.profit),
      swap: new Prisma.Decimal(report.swap),
      commission: new Prisma.Decimal(report.commission),
      netProfit: new Prisma.Decimal(netProfit),
    },
  });
}

// ===========================================================================
// Helpers
// ===========================================================================

function priceEquals(a: number | null, b: number | null): boolean {
  const left = a ?? 0;
  const right = b ?? 0;
  return Math.abs(left - right) < PRICE_EPSILON;
}

function fmt(value: number | null | undefined): string {
  return value == null || value === 0 ? 'none' : String(value);
}

// ===========================================================================
// Follower ingestion
// ===========================================================================

/**
 * Keeps a follower's positions in step with its terminal.
 *
 * Same diff as the master path, minus any task creation: a follower's trades
 * are an effect, never a cause. If a user trades manually on a follower
 * account, those positions are tracked and reported like any other — they
 * simply do not propagate anywhere.
 */
export async function ingestFollowerState(
  account: TradingAccount,
  reported: AgentOpenPosition[],
  closedReports: AgentClosedPosition[],
): Promise<{ opened: number; closed: number }> {
  const existing = await prisma.position.findMany({
    where: { accountId: account.id, status: 'OPEN' },
  });
  const existingByTicket = new Map(existing.map((p) => [p.ticket, p]));
  const reportedTickets = new Set(reported.map((p) => p.ticket));

  let opened = 0;

  for (const incoming of reported) {
    if (!existingByTicket.has(incoming.ticket)) opened++;
    // Link back to the master trade if this ticket came from one of our tasks.
    const lineage = await prisma.copyTask.findFirst({
      where: {
        followerAccountId: account.id,
        followerTicket: incoming.ticket,
        action: 'OPEN',
        status: 'SUCCESS',
      },
      select: { masterPositionId: true },
    });
    await upsertPosition(account.id, incoming, lineage?.masterPositionId ?? null);
  }

  const closedByTicket = new Map(closedReports.map((c) => [c.ticket, c]));
  let closed = 0;

  for (const prior of existing) {
    if (reportedTickets.has(prior.ticket)) continue;
    const position = await closePosition(prior, closedByTicket.get(prior.ticket));
    closed++;
    realtime.publish(account.userId, {
      type: 'position.closed',
      data: serializePosition(position, account),
    });
  }

  for (const report of closedReports) {
    if (existingByTicket.has(report.ticket)) continue;
    await recordHistoricalClose(account.id, report);
  }

  return { opened, closed };
}

/**
 * Symbols a follower should report broker volume limits for: whatever its
 * master currently holds, translated through this follower's symbol map.
 */
export async function watchSymbolsFor(account: TradingAccount): Promise<string[]> {
  const copier = await prisma.copierSettings.findUnique({
    where: { followerAccountId: account.id },
    include: { symbolMappings: true },
  });
  if (!copier) return [];

  const masterOpen = await prisma.position.findMany({
    where: { accountId: copier.masterAccountId, status: 'OPEN' },
    select: { symbol: true },
    distinct: ['symbol'],
    take: 50,
  });

  const mapped = masterOpen.map((p) => resolveSymbol(p.symbol, copier.symbolMappings));
  return [...new Set(mapped)];
}
