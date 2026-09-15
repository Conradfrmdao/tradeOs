import type { TradingAccount } from '@tradeos/db';
import type { AgentCommandResult } from '@tradeos/shared';
import { COPY_ERROR_LABELS } from '@tradeos/shared';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../lib/logger';
import { emitEvent, settleTask } from './copy-engine';
import { isRetryable, mapBrokerError } from './broker-errors';
import { notify } from '../modules/notifications/service';

/**
 * Applies the outcomes a follower reports for commands it was given.
 *
 * Returns the task ids that were recorded, which the agent uses to stop
 * resending them — the acknowledgement half of at-least-once delivery.
 */
export async function applyCommandResults(
  account: TradingAccount,
  results: AgentCommandResult[],
): Promise<string[]> {
  const acknowledged: string[] = [];

  for (const result of results) {
    try {
      const applied = await applyOne(account, result);
      // Acknowledge even results we could not act on (unknown or already
      // settled task): the agent should forget them either way, otherwise it
      // resends the same unusable result forever.
      if (applied) acknowledged.push(result.taskId);
    } catch (err) {
      logger.error({ err, taskId: result.taskId }, 'failed to apply command result');
    }
  }

  return acknowledged;
}

async function applyOne(account: TradingAccount, result: AgentCommandResult): Promise<boolean> {
  const task = await prisma.copyTask.findFirst({
    where: { id: result.taskId, followerAccountId: account.id },
    include: { masterPosition: { select: { id: true, symbol: true } } },
  });

  if (!task) {
    logger.warn({ taskId: result.taskId, accountId: account.id }, 'result for unknown task');
    return true;
  }

  // Already settled — a duplicate report after a reconnect. Acknowledge and
  // do nothing: re-settling would double-count events and could resurrect a
  // task that has since been superseded.
  if (task.status !== 'DISPATCHED' && task.status !== 'PENDING') {
    return true;
  }

  if (result.status === 'SUCCESS') {
    await settleTask(task.id, { status: 'SUCCESS', followerTicket: result.ticket });

    // Bind the follower's new position to the master trade it mirrors, so the
    // dashboard can show lineage and so a later CLOSE can find it.
    if (result.ticket && task.masterPositionId) {
      await prisma.position
        .updateMany({
          where: { accountId: account.id, ticket: result.ticket },
          data: { masterPositionId: task.masterPositionId },
        })
        .catch(() => undefined);
    }

    await emitEvent({
      userId: account.userId,
      eventType: 'COPY_EXECUTED',
      status: 'SUCCESS',
      message: describeSuccess(account.name, task.action, result),
      masterAccountId: task.masterAccountId,
      followerAccountId: account.id,
      copyTaskId: task.id,
      masterPositionId: task.masterPositionId,
      meta: {
        ticket: result.ticket,
        executedPrice: result.executedPrice,
        executedVolume: result.executedVolume,
      },
    });

    await notify(account.userId, {
      type: 'copy.executed',
      severity: 'SUCCESS',
      title: 'Trade copied',
      body: describeSuccess(account.name, task.action, result),
      emailPreference: 'notifyOnCopyOk',
    });

    return true;
  }

  if (result.status === 'SKIPPED') {
    await settleTask(task.id, {
      status: 'SKIPPED',
      errorCode: result.errorCode ?? 'UNKNOWN',
      errorMessage: result.message ?? 'Skipped by the terminal agent',
    });

    await emitEvent({
      userId: account.userId,
      eventType: 'COPY_SKIPPED',
      status: 'SKIPPED',
      message: `${account.name}: ${result.message ?? 'skipped'}`,
      masterAccountId: task.masterAccountId,
      followerAccountId: account.id,
      copyTaskId: task.id,
      errorCode: result.errorCode ?? null,
    });

    return true;
  }

  // --- FAILED --------------------------------------------------------------
  const code = mapBrokerError(account.platform, result.retcode, result.errorCode);
  const label = COPY_ERROR_LABELS[code];
  const message = result.message ? `${label} — ${result.message}` : label;

  const canRetry =
    isRetryable(code) &&
    task.attempts < task.maxAttempts &&
    task.expiresAt.getTime() > Date.now();

  if (canRetry) {
    // Back to PENDING so the next poll picks it up. `attempts` was already
    // incremented at dispatch, so the retry budget is honoured without any
    // extra bookkeeping.
    await prisma.copyTask.update({
      where: { id: task.id },
      data: {
        status: 'PENDING',
        errorCode: code,
        errorMessage: message,
        dispatchedAt: null,
      },
    });

    await emitEvent({
      userId: account.userId,
      eventType: 'COPY_FAILED',
      status: 'PENDING',
      message:
        `${account.name}: ${message} — retrying ` +
        `(attempt ${task.attempts + 1} of ${task.maxAttempts})`,
      masterAccountId: task.masterAccountId,
      followerAccountId: account.id,
      copyTaskId: task.id,
      errorCode: code,
      meta: { retcode: result.retcode },
    });

    return true;
  }

  await settleTask(task.id, { status: 'FAILED', errorCode: code, errorMessage: message });

  await emitEvent({
    userId: account.userId,
    eventType: 'COPY_FAILED',
    status: 'FAILED',
    message: `${account.name}: FAILED — ${message}`,
    masterAccountId: task.masterAccountId,
    followerAccountId: account.id,
    copyTaskId: task.id,
    masterPositionId: task.masterPositionId,
    errorCode: code,
    meta: { retcode: result.retcode, attempts: task.attempts },
  });

  await notify(account.userId, {
    type: 'copy.failed',
    severity: 'ERROR',
    title: `Copy failed on ${account.name}`,
    body: `${task.action} ${task.masterPosition?.symbol ?? ''} could not be executed: ${message}`,
    emailPreference: 'notifyOnCopyFail',
    meta: { taskId: task.id, errorCode: code },
  });

  return true;
}

function describeSuccess(
  accountName: string,
  action: string,
  result: AgentCommandResult,
): string {
  const ticket = result.ticket ? ` (ticket ${result.ticket})` : '';
  switch (action) {
    case 'OPEN':
      return `${accountName}: order confirmed${ticket}`;
    case 'CLOSE':
      return `${accountName}: position closed${ticket}`;
    case 'MODIFY':
      return `${accountName}: stops updated${ticket}`;
    default:
      return `${accountName}: ${action.toLowerCase()} confirmed${ticket}`;
  }
}

/** Retry budget exposed for the admin panel and tests. */
export const MAX_ATTEMPTS = config.COPY_MAX_ATTEMPTS;
