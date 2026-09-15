import { Prisma } from '@tradeos/db';
import type { AccountRole, TradingAccount } from '@tradeos/db';
import type { AccountDto, PortfolioDto } from '@tradeos/shared';
import { PAIRING_CODE_TTL_MINUTES } from '@tradeos/shared';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { toNum, toNumber, round2 } from '../../lib/num';
import { secondsSince, startOfLocalDay } from '../../lib/time';
import { conflict, limitReached, notFound } from '../../lib/errors';
import { generatePairingCode, hashToken, normalizePairingCode } from '../../lib/crypto';

/** Accounts the user still owns — soft-deleted rows are invisible everywhere. */
export const liveAccounts: Prisma.TradingAccountWhereInput = { deletedAt: null };

export async function getAccountOrThrow(
  userId: string,
  accountId: string,
): Promise<TradingAccount> {
  const account = await prisma.tradingAccount.findFirst({
    where: { id: accountId, userId, deletedAt: null },
  });
  if (!account) throw notFound('Trading account not found');
  return account;
}

/**
 * Builds the dashboard view of every account in one pass.
 *
 * Deliberately three aggregate queries rather than a per-account loop: with 11
 * accounts a loop is 33 round trips, and it degrades as the account limit is
 * raised.
 */
export async function listAccountDtos(userId: string, timeZone: string): Promise<AccountDto[]> {
  const dayStart = startOfLocalDay(timeZone);
  const now = new Date();

  const [accounts, todayByAccount, totalByAccount, openByAccount, copiers] = await Promise.all([
    prisma.tradingAccount.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: { agentToken: { select: { pairedAt: true, revokedAt: true } } },
    }),
    prisma.position.groupBy({
      by: ['accountId'],
      where: { account: { userId, deletedAt: null }, status: 'CLOSED', closeTime: { gte: dayStart } },
      _sum: { netProfit: true },
    }),
    prisma.position.groupBy({
      by: ['accountId'],
      where: { account: { userId, deletedAt: null }, status: 'CLOSED' },
      _sum: { netProfit: true },
    }),
    prisma.position.groupBy({
      by: ['accountId'],
      where: { account: { userId, deletedAt: null }, status: 'OPEN' },
      _count: { _all: true },
      _sum: { profit: true },
    }),
    prisma.copierSettings.findMany({
      where: { userId },
      select: { followerAccountId: true, enabled: true },
    }),
  ]);

  const todayMap = new Map(todayByAccount.map((r) => [r.accountId, toNum(r._sum.netProfit)]));
  const totalMap = new Map(totalByAccount.map((r) => [r.accountId, toNum(r._sum.netProfit)]));
  const openMap = new Map(
    openByAccount.map((r) => [r.accountId, { count: r._count._all, floating: toNum(r._sum.profit) }]),
  );
  const copyMap = new Map(copiers.map((c) => [c.followerAccountId, c.enabled]));

  return accounts.map((account) => {
    const open = openMap.get(account.id);
    const heartbeatAge = secondsSince(account.lastHeartbeatAt, now);

    return {
      id: account.id,
      name: account.name,
      platform: account.platform,
      broker: account.broker,
      accountNumber: account.accountNumber,
      server: account.server,
      currency: account.currency,
      leverage: account.leverage,
      role: account.role,
      status: account.status,
      enabled: account.enabled,

      balance: toNumber(account.balance),
      equity: toNumber(account.equity),
      margin: toNumber(account.margin),
      freeMargin: toNumber(account.freeMargin),
      marginLevel: toNumber(account.marginLevel),
      // Prefer the terminal's own figure; fall back to summing open positions
      // so a freshly connected account is not blank.
      floatingPl: toNumber(account.floatingPl) ?? open?.floating ?? 0,

      todayPl: todayMap.get(account.id) ?? 0,
      totalPl: totalMap.get(account.id) ?? 0,
      openPositions: open?.count ?? 0,

      lastHeartbeatAt: account.lastHeartbeatAt?.toISOString() ?? null,
      heartbeatAgeSeconds: heartbeatAge,
      lastError: account.lastError,
      agentVersion: account.agentVersion,

      copying: account.role === 'FOLLOWER' ? (copyMap.get(account.id) ?? false) : null,
      paired: Boolean(account.agentToken?.pairedAt && !account.agentToken.revokedAt),
      createdAt: account.createdAt.toISOString(),
    } satisfies AccountDto;
  });
}

export async function getPortfolio(userId: string, timeZone: string): Promise<PortfolioDto> {
  const accounts = await listAccountDtos(userId, timeZone);
  const settings = await prisma.userSettings.findUnique({ where: { userId } });

  // Only accounts reporting live figures contribute to balance/equity totals —
  // a disconnected account's last-known balance is stale, but still the best
  // number available, so it is included rather than silently dropped to zero.
  return {
    totalBalance: round2(accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0)),
    totalEquity: round2(accounts.reduce((sum, a) => sum + (a.equity ?? 0), 0)),
    todayPl: round2(accounts.reduce((sum, a) => sum + a.todayPl, 0)),
    totalPl: round2(accounts.reduce((sum, a) => sum + a.totalPl, 0)),
    floatingPl: round2(accounts.reduce((sum, a) => sum + (a.floatingPl ?? 0), 0)),
    openPositions: accounts.reduce((sum, a) => sum + a.openPositions, 0),
    connectedAccounts: accounts.filter((a) => a.status === 'CONNECTED').length,
    totalAccounts: accounts.length,
    maxAccounts: config.maxAccounts,
    copyingEnabled: settings?.copyingEnabled ?? true,
    emergencyStopAt: settings?.emergencyStopAt?.toISOString() ?? null,
  };
}

/**
 * Enforces the per-role account limits from PRD 38.
 * Both limits come from config, so raising them is a deployment change rather
 * than a code change.
 */
export async function assertCanAddAccount(userId: string, role: AccountRole): Promise<void> {
  const count = await prisma.tradingAccount.count({
    where: { userId, role, deletedAt: null },
  });

  if (role === 'MASTER' && count >= config.MAX_MASTER_ACCOUNTS) {
    throw limitReached(
      config.MAX_MASTER_ACCOUNTS === 1
        ? 'You already have a master account. Remove it first, or connect this one as a follower.'
        : `You have reached the limit of ${config.MAX_MASTER_ACCOUNTS} master accounts.`,
    );
  }

  if (role === 'FOLLOWER' && count >= config.MAX_FOLLOWER_ACCOUNTS) {
    throw limitReached(
      `You have reached the limit of ${config.MAX_FOLLOWER_ACCOUNTS} follower accounts.`,
    );
  }
}

export async function assertAccountNotDuplicated(
  userId: string,
  platform: 'MT4' | 'MT5',
  accountNumber: string,
  server: string | null,
): Promise<void> {
  const existing = await prisma.tradingAccount.findFirst({
    where: { userId, platform, accountNumber, server, deletedAt: null },
  });
  if (existing) {
    throw conflict(
      `${platform} account ${accountNumber} is already connected as "${existing.name}"`,
      'ACCOUNT_EXISTS',
    );
  }
}

/**
 * Issues a fresh pairing code for an account.
 *
 * Only the hash is stored, and issuing a new code invalidates the previous one
 * — a code left on a screen an hour ago should not still work.
 */
export async function issuePairingCode(accountId: string): Promise<{
  pairingCode: string;
  expiresAt: Date;
}> {
  const pairingCode = generatePairingCode(12);
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000);

  await prisma.agentToken.upsert({
    where: { accountId },
    create: {
      accountId,
      pairingCodeHash: hashToken(normalizePairingCode(pairingCode)),
      pairingExpiresAt: expiresAt,
    },
    update: {
      pairingCodeHash: hashToken(normalizePairingCode(pairingCode)),
      pairingExpiresAt: expiresAt,
      // Re-pairing replaces any previous agent: the old token stops working.
      tokenHash: null,
      pairedAt: null,
      revokedAt: null,
    },
  });

  return { pairingCode, expiresAt };
}

/**
 * Soft-deletes an account and revokes its agent.
 *
 * Closed trades and copy events are kept: a user removing an account should
 * not silently erase the history their statistics were built from.
 */
export async function removeAccount(userId: string, accountId: string): Promise<void> {
  const account = await getAccountOrThrow(userId, accountId);

  await prisma.$transaction([
    prisma.agentToken.updateMany({
      where: { accountId },
      data: { revokedAt: new Date(), tokenHash: null, pairingCodeHash: null },
    }),
    // Cancel work that is still in flight so a removed account cannot receive
    // a trade seconds after the user removed it.
    prisma.copyTask.updateMany({
      where: {
        OR: [{ followerAccountId: accountId }, { masterAccountId: accountId }],
        status: { in: ['PENDING', 'DISPATCHED'] },
      },
      data: {
        status: 'SKIPPED',
        errorCode: 'POSITION_NOT_FOUND',
        errorMessage: 'Account was removed',
        completedAt: new Date(),
      },
    }),
    prisma.copierSettings.deleteMany({
      where: { OR: [{ followerAccountId: accountId }, { masterAccountId: accountId }] },
    }),
    prisma.tradingAccount.update({
      where: { id: account.id },
      data: {
        deletedAt: new Date(),
        status: 'DISABLED',
        enabled: false,
        // Drop any stored secret material at the moment it stops being needed.
        encryptedCredentials: Prisma.DbNull,
      },
    }),
  ]);
}

