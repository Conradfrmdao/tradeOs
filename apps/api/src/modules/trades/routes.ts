import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@tradeos/db';
import { historyQuerySchema, openTradesQuerySchema } from '@tradeos/shared';
import { prisma } from '../../lib/prisma';
import { requireUser } from '../../plugins/auth';
import { serializePosition } from '../../lib/serialize';
import { sumOf } from '../../lib/num';

export async function tradeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // GET /trades/open (PRD 18)
  // -------------------------------------------------------------------------
  app.get('/trades/open', async (request, reply) => {
    const user = requireUser(request);
    const query = openTradesQuerySchema.parse(request.query);

    const where: Prisma.PositionWhereInput = {
      status: 'OPEN',
      account: {
        userId: user.id,
        deletedAt: null,
        ...(query.accountId ? { id: query.accountId } : {}),
        ...(query.scope === 'master'
          ? { role: 'MASTER' as const }
          : query.scope === 'followers'
            ? { role: 'FOLLOWER' as const }
            : {}),
      },
      ...(query.symbol ? { symbol: { contains: query.symbol, mode: 'insensitive' } } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      // "Profitable" and "losing" are evaluated on floating profit, which is
      // what the trader is actually looking at on the screen.
      ...(query.pnl === 'profitable'
        ? { profit: { gt: 0 } }
        : query.pnl === 'losing'
          ? { profit: { lt: 0 } }
          : {}),
    };

    const [items, total, all] = await Promise.all([
      prisma.position.findMany({
        where,
        orderBy: { openTime: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { account: { select: { id: true, name: true, role: true } } },
      }),
      prisma.position.count({ where }),
      // Totals cover the whole filtered set, not just the page on screen —
      // a footer that only sums the visible rows is actively misleading.
      prisma.position.findMany({ where, select: { profit: true, swap: true, commission: true, volume: true } }),
    ]);

    return reply.send({
      items: items.map((p) => serializePosition(p, p.account)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      totals: {
        floatingPl: sumOf(all, (p) => p.profit),
        swap: sumOf(all, (p) => p.swap),
        commission: sumOf(all, (p) => p.commission),
        volume: sumOf(all, (p) => p.volume),
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /trades/history (PRD 19)
  // -------------------------------------------------------------------------
  app.get('/trades/history', async (request, reply) => {
    const user = requireUser(request);
    const query = historyQuerySchema.parse(request.query);

    const where: Prisma.PositionWhereInput = {
      status: 'CLOSED',
      account: {
        userId: user.id,
        deletedAt: null,
        ...(query.accountId ? { id: query.accountId } : {}),
        ...(query.scope === 'master'
          ? { role: 'MASTER' as const }
          : query.scope === 'followers'
            ? { role: 'FOLLOWER' as const }
            : {}),
      },
      ...(query.symbol ? { symbol: { contains: query.symbol, mode: 'insensitive' } } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.search
        ? {
            OR: [
              { symbol: { contains: query.search, mode: 'insensitive' as const } },
              { ticket: { contains: query.search } },
              { comment: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            closeTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total, all] = await Promise.all([
      prisma.position.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortDir },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { account: { select: { id: true, name: true, role: true } } },
      }),
      prisma.position.count({ where }),
      prisma.position.findMany({
        where,
        select: { profit: true, swap: true, commission: true, netProfit: true, volume: true },
      }),
    ]);

    return reply.send({
      items: items.map((p) => serializePosition(p, p.account)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      totals: {
        profit: sumOf(all, (p) => p.profit),
        swap: sumOf(all, (p) => p.swap),
        commission: sumOf(all, (p) => p.commission),
        netProfit: sumOf(all, (p) => p.netProfit),
        volume: sumOf(all, (p) => p.volume),
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /trades/:id/copies — follower trades mirroring one master trade
  // -------------------------------------------------------------------------
  app.get('/trades/:id/copies', async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };

    const master = await prisma.position.findFirst({
      where: { id, account: { userId: user.id, deletedAt: null } },
    });
    if (!master) return reply.send({ master: null, copies: [] });

    const copies = await prisma.position.findMany({
      where: { masterPositionId: id },
      include: { account: { select: { id: true, name: true, role: true } } },
      orderBy: { openTime: 'asc' },
    });

    const account = await prisma.tradingAccount.findUnique({
      where: { id: master.accountId },
      select: { id: true, name: true, role: true },
    });

    return reply.send({
      master: account ? serializePosition(master, account) : null,
      copies: copies.map((p) => serializePosition(p, p.account)),
    });
  });
}
