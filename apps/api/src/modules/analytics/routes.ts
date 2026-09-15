import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  chartQuerySchema,
  computeMaxDrawdown,
  computeTradeStats,
  cumulativeProfitSeries,
  mergeTradeStats,
  type AccountStatsDto,
  type EquityPointDto,
} from '@tradeos/shared';
import { prisma } from '../../lib/prisma';
import { requireUser, userTimezone } from '../../plugins/auth';
import { toNum } from '../../lib/num';
import { rangeStart, startOfLocalDay, startOfLocalMonth, startOfLocalWeek } from '../../lib/time';

const idParam = z.object({ id: z.string().uuid() });

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // GET /analytics/accounts/:id/stats (PRD 20)
  // -------------------------------------------------------------------------
  app.get('/analytics/accounts/:id/stats', async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const account = await prisma.tradingAccount.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!account) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found' } });

    const stats = await statsForAccount(account.id, account.name);
    return reply.send({ stats });
  });

  // -------------------------------------------------------------------------
  // GET /analytics/portfolio (PRD 22)
  // -------------------------------------------------------------------------
  app.get('/analytics/portfolio', async (request, reply) => {
    const user = requireUser(request);
    const timeZone = userTimezone(user);

    const accounts = await prisma.tradingAccount.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { id: true, name: true },
    });

    const perAccount = await Promise.all(
      accounts.map((a) => statsForAccount(a.id, a.name)),
    );

    const combined = mergeTradeStats(perAccount);

    // Period P/L is realised profit within each window, in the user's own
    // timezone — the same basis as the "today" figure on the dashboard.
    const [dayPl, weekPl, monthPl] = await Promise.all([
      realisedSince(user.id, startOfLocalDay(timeZone)),
      realisedSince(user.id, startOfLocalWeek(timeZone)),
      realisedSince(user.id, startOfLocalMonth(timeZone)),
    ]);

    // Portfolio drawdown is measured on total equity across accounts, not by
    // averaging per-account drawdowns: accounts draw down at different times,
    // and averaging would understate the worst moment the portfolio saw.
    const portfolioCurve = await portfolioEquitySeries(user.id, null);
    const drawdown = computeMaxDrawdown(portfolioCurve.map((p) => p.equity));

    return reply.send({
      stats: combined,
      todayPl: dayPl,
      weekPl,
      monthPl,
      maxDrawdown: drawdown.absolute,
      maxDrawdownPercent: drawdown.percent,
      accounts: perAccount,
    });
  });

  // -------------------------------------------------------------------------
  // GET /analytics/equity (PRD 21)
  // -------------------------------------------------------------------------
  app.get('/analytics/equity', async (request, reply) => {
    const user = requireUser(request);
    const query = chartQuerySchema.parse(request.query);
    const timeZone = userTimezone(user);
    const from = rangeStart(query.range, timeZone);

    const points = await portfolioEquitySeries(user.id, from, query.accountId);

    return reply.send({ range: query.range, points });
  });

  // -------------------------------------------------------------------------
  // GET /analytics/comparison (PRD 23)
  // -------------------------------------------------------------------------
  app.get('/analytics/comparison', async (request, reply) => {
    const user = requireUser(request);

    const accounts = await prisma.tradingAccount.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, role: true, balance: true, equity: true, currency: true },
    });

    const rows = await Promise.all(
      accounts.map(async (account) => {
        const stats = await statsForAccount(account.id, account.name);
        return {
          accountId: account.id,
          accountName: account.name,
          role: account.role,
          currency: account.currency,
          balance: toNum(account.balance),
          equity: toNum(account.equity),
          netProfit: stats.netProfit,
          winRate: stats.winRate,
          profitFactor: stats.profitFactor,
          totalTrades: stats.totalTrades,
          maxDrawdownPercent: stats.maxDrawdownPercent,
        };
      }),
    );

    return reply.send({ rows });
  });
}

// ===========================================================================
// Helpers
// ===========================================================================

async function statsForAccount(accountId: string, accountName: string): Promise<AccountStatsDto> {
  const trades = await prisma.position.findMany({
    where: { accountId, status: 'CLOSED', closeTime: { not: null } },
    select: { netProfit: true, volume: true, closeTime: true },
    orderBy: { closeTime: 'asc' },
  });

  const stats = computeTradeStats(
    trades.map((t) => ({
      netProfit: toNum(t.netProfit),
      volume: toNum(t.volume),
      closeTime: t.closeTime!,
    })),
  );

  // Prefer real equity samples; fall back to a cumulative-profit curve so a
  // freshly connected account with imported history still reports a drawdown
  // rather than a misleading zero.
  const snapshots = await prisma.equitySnapshot.findMany({
    where: { accountId },
    orderBy: { at: 'asc' },
    select: { equity: true },
    take: 20_000,
  });

  const series =
    snapshots.length > 1
      ? snapshots.map((s) => toNum(s.equity))
      : cumulativeProfitSeries(
          trades.map((t) => ({
            netProfit: toNum(t.netProfit),
            volume: toNum(t.volume),
            closeTime: t.closeTime!,
          })),
        );

  const drawdown = computeMaxDrawdown(series);

  return {
    ...stats,
    accountId,
    accountName,
    maxDrawdown: drawdown.absolute,
    maxDrawdownPercent: drawdown.percent,
  };
}

async function realisedSince(userId: string, since: Date): Promise<number> {
  const result = await prisma.position.aggregate({
    where: {
      status: 'CLOSED',
      closeTime: { gte: since },
      account: { userId, deletedAt: null },
    },
    _sum: { netProfit: true },
  });
  return toNum(result._sum.netProfit);
}

/**
 * Builds a combined equity curve.
 *
 * Samples land on minute boundaries (the agent sync upserts them that way), so
 * accounts can be summed per timestamp without interpolation. A minute where
 * one account did not report contributes only the accounts that did — which is
 * why the series is built from a grouped aggregate rather than a join.
 */
async function portfolioEquitySeries(
  userId: string,
  from: Date | null,
  accountId?: string,
): Promise<EquityPointDto[]> {
  const grouped = await prisma.equitySnapshot.groupBy({
    by: ['at'],
    where: {
      account: {
        userId,
        deletedAt: null,
        ...(accountId ? { id: accountId } : {}),
      },
      ...(from ? { at: { gte: from } } : {}),
    },
    _sum: { equity: true, balance: true },
    orderBy: { at: 'asc' },
    take: 5000,
  });

  return grouped.map((row) => ({
    at: row.at.toISOString(),
    equity: toNum(row._sum.equity),
    balance: toNum(row._sum.balance),
  }));
}
