import { prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../lib/logger';
import { realtime } from '../lib/realtime';
import { emitEvent, expireTasks } from './copy-engine';
import { notify } from '../modules/notifications/service';
import { listAccountDtos, getPortfolio } from '../modules/accounts/service';

/**
 * Background supervisor (PRD 24).
 *
 * Two jobs that both have to happen whether or not anyone is polling:
 *  1. mark accounts DISCONNECTED once their agent stops checking in
 *  2. expire copy tasks nobody came to collect
 *
 * A follower going quiet is the failure mode most likely to lose a user money
 * without anyone noticing, so it is surfaced loudly: a status change, an event
 * in the copy log, a dashboard notification, and an email.
 */

let timer: NodeJS.Timeout | null = null;

const TICK_MS = 5_000;

export function startHeartbeatMonitor(): void {
  if (timer) return;

  timer = setInterval(() => {
    void tick().catch((err) => logger.error({ err }, 'heartbeat monitor tick failed'));
  }, TICK_MS);

  // Do not hold the process open for this timer — shutdown should not wait.
  timer.unref();

  logger.info(
    { timeoutSeconds: config.AGENT_HEARTBEAT_TIMEOUT_SECONDS },
    'heartbeat monitor started',
  );
}

export function stopHeartbeatMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function tick(now = new Date()): Promise<void> {
  await Promise.all([detectDisconnections(now), expireTasks(null, now)]);
}

/** Last sweep in this process/instance. Reset by a cold start, which is fine. */
let lastSweepAt = 0;

/**
 * Runs the supervisor opportunistically, from inside a request.
 *
 * Serverless has no timer that survives between invocations, so the work that
 * `startHeartbeatMonitor` does on an interval has to be driven by traffic
 * instead. Agents poll constantly while anything is connected, which is
 * exactly when this work matters — and when nothing is polling there is, by
 * definition, nothing left to supervise.
 *
 * Throttled per warm instance and awaited by callers who can afford it; the
 * queries involved are indexed and return nothing in the common case.
 */
export async function sweepIfDue(intervalMs = TICK_MS * 3): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < intervalMs) return;
  lastSweepAt = now;

  try {
    await tick(new Date(now));
  } catch (err) {
    // Never let supervision failures break the request that triggered them.
    logger.error({ err }, 'opportunistic heartbeat sweep failed');
  }
}

async function detectDisconnections(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - config.AGENT_HEARTBEAT_TIMEOUT_SECONDS * 1000);

  const stale = await prisma.tradingAccount.findMany({
    where: {
      deletedAt: null,
      status: 'CONNECTED',
      lastHeartbeatAt: { lt: cutoff },
    },
    take: 200,
  });

  if (stale.length === 0) return;

  for (const account of stale) {
    await prisma.tradingAccount.update({
      where: { id: account.id },
      data: {
        status: 'DISCONNECTED',
        lastError: `No data from the terminal for ${config.AGENT_HEARTBEAT_TIMEOUT_SECONDS}s`,
      },
    });

    await emitEvent({
      userId: account.userId,
      eventType: 'ACCOUNT_DISCONNECTED',
      status: 'FAILED',
      message:
        `${account.name} disconnected — no data from the terminal for ` +
        `${config.AGENT_HEARTBEAT_TIMEOUT_SECONDS}s`,
      masterAccountId: account.role === 'MASTER' ? account.id : null,
      followerAccountId: account.role === 'FOLLOWER' ? account.id : null,
    });

    await notify(account.userId, {
      type: 'account.disconnected',
      severity: 'ERROR',
      title: `${account.name} went offline`,
      body:
        account.role === 'MASTER'
          ? 'No trades can be detected or copied while the master terminal is offline. ' +
            'Check that MetaTrader is running and the TradeOS agent is on a chart.'
          : 'This follower will not receive copied trades while it is offline. ' +
            'Check that MetaTrader is running and the TradeOS agent is on a chart.',
      emailPreference: 'notifyOnDisconnect',
      meta: { accountId: account.id },
    });

    logger.warn(
      { accountId: account.id, name: account.name, role: account.role },
      'account marked disconnected',
    );
  }

  // Refresh dashboards once per affected user, not once per account.
  const userIds = [...new Set(stale.map((a) => a.userId))];
  for (const userId of userIds) {
    if (!realtime.hasLocalListeners(userId)) continue;
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
      logger.warn({ err, userId }, 'failed to push disconnect state');
    }
  }
}
