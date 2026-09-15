import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentSyncResponse } from '@tradeos/shared';
import { buildApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

/**
 * End-to-end exercise of the PRD 40 success criteria and the PRD 42
 * idempotency requirement, driven through the real HTTP surface with
 * `app.inject` — no mocks below the route layer, and a real database.
 *
 * The scenario is the one from the PRD: a master opens a trade, a follower
 * copies it at half size, the master closes it, the follower closes too, and
 * the whole thing is visible in the copy event log.
 */

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
let cookies = '';
let csrf = '';
let userId = '';
let masterId = '';
let followerId = '';
let masterToken = '';
let followerToken = '';

const email = `e2e-${Date.now()}@tradeos.test`;
const PASSWORD = 'correct-horse-battery-staple';

/**
 * Auth headers only. Content-type is deliberately omitted: `app.inject` sets
 * it when a payload is present, and sending it on a body-less POST makes
 * Fastify reject the request as an empty JSON body.
 */
function headers(extra: Record<string, string> = {}) {
  return { cookie: cookies, 'x-csrf-token': csrf, ...extra };
}

function captureCookies(raw: unknown): void {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const jar = new Map<string, string>();
  for (const part of cookies.split('; ').filter(Boolean)) {
    const [k, ...v] = part.split('=');
    if (k) jar.set(k, v.join('='));
  }
  for (const entry of list as string[]) {
    const [pair] = entry.split(';');
    const [k, ...v] = (pair ?? '').split('=');
    if (!k) continue;
    jar.set(k, v.join('='));
    if (k === 'tos_csrf') csrf = v.join('=');
  }
  cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Minimal account state an agent reports on every sync. */
const accountState = (balance: number, equity: number) => ({
  balance,
  equity,
  margin: 0,
  freeMargin: balance,
  marginLevel: 0,
  credit: 0,
  currency: 'USD',
  tradeAllowed: true,
});

async function sync(
  token: string,
  body: Record<string, unknown>,
): Promise<AgentSyncResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/agent/v1/sync',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { protocolVersion: 1, ...body },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AgentSyncResponse;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // --- account + verified email -------------------------------------------
  const signup = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { name: 'E2E Trader', email, password: PASSWORD, confirmPassword: PASSWORD },
  });
  expect(signup.statusCode, signup.body).toBe(201);
  captureCookies(signup.headers['set-cookie']);
  userId = signup.json().user.id;

  // Connecting accounts requires a verified email; verifying through the real
  // token flow would only re-test the mailer.
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
}, 60_000);

afterAll(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close();
  await prisma.$disconnect();
});

describe('connect and pair accounts', () => {
  it('connects a master account and pairs its agent', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: headers(),
      payload: {
        name: 'My Master',
        platform: 'MT5',
        role: 'MASTER',
        broker: 'TestBroker',
        accountNumber: '12345678',
        server: 'TestBroker-Demo',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    masterId = created.json().accountId;

    const paired = await app.inject({
      method: 'POST',
      url: '/agent/v1/pair',
      payload: {
        pairingCode: created.json().pairing.pairingCode,
        platform: 'MT5',
        accountNumber: '12345678',
        server: 'TestBroker-Demo',
        broker: 'TestBroker',
        agentVersion: '1.0.0',
      },
    });
    expect(paired.statusCode, paired.body).toBe(200);
    masterToken = paired.json().token;
    expect(paired.json().role).toBe('MASTER');
  });

  it('rejects a pairing code used for the wrong terminal', async () => {
    const code = await app.inject({
      method: 'POST',
      url: `/accounts/${masterId}/pairing-code`,
      headers: headers(),
    });

    const wrong = await app.inject({
      method: 'POST',
      url: '/agent/v1/pair',
      payload: {
        pairingCode: code.json().pairing.pairingCode,
        platform: 'MT5',
        accountNumber: '99999999', // a different terminal
      },
    });

    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.message).toContain('12345678');

    // Re-pair the real terminal, since the test above burned the code.
    const again = await app.inject({
      method: 'POST',
      url: `/accounts/${masterId}/pairing-code`,
      headers: headers(),
    });
    const ok = await app.inject({
      method: 'POST',
      url: '/agent/v1/pair',
      payload: {
        pairingCode: again.json().pairing.pairingCode,
        platform: 'MT5',
        accountNumber: '12345678',
      },
    });
    masterToken = ok.json().token;
  });

  it('connects a follower and enables copying at half size', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: headers(),
      payload: {
        name: 'Funded Account 01',
        platform: 'MT5',
        role: 'FOLLOWER',
        broker: 'TestBroker',
        accountNumber: '87654321',
        server: 'TestBroker-Demo',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    followerId = created.json().accountId;

    const paired = await app.inject({
      method: 'POST',
      url: '/agent/v1/pair',
      payload: {
        pairingCode: created.json().pairing.pairingCode,
        platform: 'MT5',
        accountNumber: '87654321',
      },
    });
    followerToken = paired.json().token;

    const copiers = await app.inject({ method: 'GET', url: '/copier', headers: headers() });
    const copier = copiers.json().copiers[0];
    expect(copier.followerAccountId).toBe(followerId);
    // A new follower starts with copying off — the user opts in deliberately.
    expect(copier.enabled).toBe(false);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/copier/${copier.id}`,
      headers: headers(),
      payload: { enabled: true, riskMode: 'LOT_MULTIPLIER', lotMultiplier: 0.5 },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().copier.enabled).toBe(true);
  });
});

describe('copying a trade end to end', () => {
  const OPEN_POSITION = {
    ticket: '500001',
    positionId: '500001',
    symbol: 'EURUSD',
    direction: 'BUY' as const,
    volume: 1.0,
    openPrice: 1.17,
    currentPrice: 1.172,
    stopLoss: 1.165,
    takeProfit: 1.18,
    profit: 200,
    swap: 0,
    commission: -7,
    openTime: new Date().toISOString(),
  };

  it('treats the first master snapshot as a baseline, not a signal', async () => {
    // First sync carries a position that was already open. Copying it would
    // fire a trade the user never asked for.
    const res = await sync(masterToken, {
      account: accountState(10_000, 10_193),
      positions: [{ ...OPEN_POSITION, ticket: '499000', positionId: '499000' }],
    });
    expect(res.role).toBe('MASTER');

    const tasks = await prisma.copyTask.count({ where: { followerAccountId: followerId } });
    expect(tasks).toBe(0);
  });

  it('queues a copy task when the master opens a new trade', async () => {
    await sync(masterToken, {
      account: accountState(10_000, 10_193),
      positions: [
        { ...OPEN_POSITION, ticket: '499000', positionId: '499000' },
        OPEN_POSITION,
      ],
    });

    const tasks = await prisma.copyTask.findMany({ where: { followerAccountId: followerId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.action).toBe('OPEN');
    expect(tasks[0]!.status).toBe('PENDING');
    expect((tasks[0]!.payload as { volume: number }).volume).toBe(0.5);
  });

  it('does not duplicate the task when the same snapshot is replayed', async () => {
    // Simulates an agent reconnect / server restart / retried request: the
    // identical snapshot arrives again, several times.
    for (let i = 0; i < 3; i++) {
      await sync(masterToken, {
        account: accountState(10_000, 10_193),
        positions: [
          { ...OPEN_POSITION, ticket: '499000', positionId: '499000' },
          OPEN_POSITION,
        ],
      });
    }

    const tasks = await prisma.copyTask.findMany({
      where: { followerAccountId: followerId, action: 'OPEN' },
    });
    expect(tasks).toHaveLength(1);
  });

  it('hands the follower a correctly sized command', async () => {
    const res = await sync(followerToken, {
      account: accountState(100_000, 100_000),
      positions: [],
    });

    expect(res.role).toBe('FOLLOWER');
    expect(res.copyingEnabled).toBe(true);
    expect(res.commands).toHaveLength(1);

    const command = res.commands[0]!;
    expect(command.action).toBe('OPEN');
    expect(command.symbol).toBe('EURUSD');
    expect(command.direction).toBe('BUY');
    expect(command.volume).toBe(0.5); // 1.00 master x 0.5 multiplier
    expect(command.stopLoss).toBe(1.165);
    expect(command.takeProfit).toBe(1.18);
  });

  it('does not re-issue a command that is already dispatched', async () => {
    const res = await sync(followerToken, {
      account: accountState(100_000, 100_000),
      positions: [],
    });
    expect(res.commands).toHaveLength(0);
  });

  it('records the execution and links the follower position to the master', async () => {
    const task = await prisma.copyTask.findFirstOrThrow({
      where: { followerAccountId: followerId, action: 'OPEN' },
    });

    const res = await sync(followerToken, {
      account: accountState(100_000, 100_100),
      positions: [
        {
          ticket: '900001',
          positionId: '900001',
          symbol: 'EURUSD',
          direction: 'BUY',
          volume: 0.5,
          openPrice: 1.1701,
          currentPrice: 1.172,
          stopLoss: 1.165,
          takeProfit: 1.18,
          profit: 95,
          swap: 0,
          commission: -3.5,
          openTime: new Date().toISOString(),
        },
      ],
      results: [
        { taskId: task.id, status: 'SUCCESS', ticket: '900001', executedPrice: 1.1701 },
      ],
    });

    expect(res.acknowledged).toContain(task.id);

    const settled = await prisma.copyTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(settled.status).toBe('SUCCESS');
    expect(settled.followerTicket).toBe('900001');

    const followerPosition = await prisma.position.findFirstOrThrow({
      where: { accountId: followerId, ticket: '900001' },
    });
    expect(followerPosition.masterPositionId).toBe(settled.masterPositionId);
  });

  it('closes the follower position when the master closes', async () => {
    // Master reports the trade gone, plus the closed deal in its history.
    await sync(masterToken, {
      account: accountState(10_193, 10_193),
      positions: [{ ...OPEN_POSITION, ticket: '499000', positionId: '499000' }],
      closed: [
        {
          ...OPEN_POSITION,
          closePrice: 1.172,
          closeTime: new Date().toISOString(),
        },
      ],
    });

    const closeTask = await prisma.copyTask.findFirstOrThrow({
      where: { followerAccountId: followerId, action: 'CLOSE' },
    });
    expect(closeTask.status).toBe('PENDING');

    const res = await sync(followerToken, {
      account: accountState(100_000, 100_100),
      positions: [
        {
          ticket: '900001',
          symbol: 'EURUSD',
          direction: 'BUY',
          volume: 0.5,
          openPrice: 1.1701,
          currentPrice: 1.172,
          profit: 95,
          swap: 0,
          commission: -3.5,
          openTime: new Date().toISOString(),
        },
      ],
    });

    expect(res.commands).toHaveLength(1);
    expect(res.commands[0]!.action).toBe('CLOSE');
    // The close targets the follower's own ticket, resolved from the OPEN task.
    expect(res.commands[0]!.targetTicket).toBe('900001');

    await sync(followerToken, {
      account: accountState(100_091, 100_091),
      positions: [],
      closed: [
        {
          ticket: '900001',
          symbol: 'EURUSD',
          direction: 'BUY',
          volume: 0.5,
          openPrice: 1.1701,
          closePrice: 1.172,
          profit: 95,
          swap: 0,
          commission: -3.5,
          openTime: new Date().toISOString(),
          closeTime: new Date().toISOString(),
        },
      ],
      results: [{ taskId: res.commands[0]!.id, status: 'SUCCESS', ticket: '900001' }],
    });

    const position = await prisma.position.findFirstOrThrow({
      where: { accountId: followerId, ticket: '900001' },
    });
    expect(position.status).toBe('CLOSED');
    expect(Number(position.netProfit)).toBeCloseTo(91.5, 2);
  });

  it('shows the whole operation in the copy event log', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/copier/events?pageSize=100',
      headers: headers(),
    });

    const types = res.json().items.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain('MASTER_OPEN');
    expect(types).toContain('COPY_QUEUED');
    expect(types).toContain('COPY_DISPATCHED');
    expect(types).toContain('COPY_EXECUTED');
    expect(types).toContain('MASTER_CLOSE');
  });

  it('reports portfolio totals and statistics', async () => {
    const portfolio = await app.inject({ method: 'GET', url: '/portfolio', headers: headers() });
    expect(portfolio.json().portfolio.totalAccounts).toBe(2);
    expect(portfolio.json().portfolio.connectedAccounts).toBe(2);

    const stats = await app.inject({
      method: 'GET',
      url: '/analytics/portfolio',
      headers: headers(),
    });
    expect(stats.json().stats.totalTrades).toBeGreaterThan(0);
    expect(stats.json().stats.winningTrades).toBeGreaterThan(0);
  });
});

describe('the kill switch', () => {
  it('stops new copies without touching open positions', async () => {
    const before = await prisma.position.count({
      where: { accountId: followerId, status: 'OPEN' },
    });

    const stop = await app.inject({
      method: 'POST',
      url: '/copier/emergency-stop',
      headers: headers(),
    });
    expect(stop.statusCode, stop.body).toBe(200);

    // A brand new master trade must now produce nothing.
    await sync(masterToken, {
      account: accountState(10_193, 10_193),
      positions: [
        { ...OPEN_POSITION_AFTER_STOP },
        { ...OPEN_POSITION_AFTER_STOP, ticket: '499000', positionId: '499000' },
      ],
    });

    const tasks = await prisma.copyTask.count({
      where: { followerAccountId: followerId, status: 'PENDING' },
    });
    expect(tasks).toBe(0);

    const after = await prisma.position.count({
      where: { accountId: followerId, status: 'OPEN' },
    });
    expect(after).toBe(before);
  });
});

const OPEN_POSITION_AFTER_STOP = {
  ticket: '500002',
  positionId: '500002',
  symbol: 'GBPUSD',
  direction: 'SELL' as const,
  volume: 0.5,
  openPrice: 1.35,
  currentPrice: 1.347,
  profit: 150,
  swap: 0,
  commission: -3,
  openTime: new Date().toISOString(),
};

describe('removing and reconnecting an account', () => {
  it('lets the same trading account be added again after it was removed', async () => {
    // Regression: the uniqueness rule used to count soft-deleted rows, so a
    // user who removed an account could never reconnect it — the slot stayed
    // occupied by a row they could no longer see.
    const details = {
      name: 'Temp Account',
      platform: 'MT5' as const,
      role: 'FOLLOWER' as const,
      broker: 'TestBroker',
      accountNumber: '44556677',
      server: 'TestBroker-Demo',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: headers(),
      payload: details,
    });
    expect(first.statusCode, first.body).toBe(201);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/accounts/${first.json().accountId}`,
      headers: headers(),
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: headers(),
      payload: { ...details, name: 'Reconnected Account' },
    });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().accountId).not.toBe(first.json().accountId);
  });

  it('still refuses two live accounts with the same broker login', async () => {
    const details = {
      name: 'Duplicate Attempt',
      platform: 'MT5' as const,
      role: 'FOLLOWER' as const,
      accountNumber: '87654321', // already connected as "Funded Account 01"
      server: 'TestBroker-Demo',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: headers(),
      payload: details,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ACCOUNT_EXISTS');
  });
});
