'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AccountDto, AccountStatsDto, PairingDto, PositionDto } from '@tradeos/shared';
import { formatAge, formatLots, formatMoney, formatPercent, formatPrice } from '@tradeos/shared';
import { get, post } from '@/lib/api';
import { useLiveData } from '@/lib/live-data';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Money,
  PageHeader,
  SkeletonScreen,
  SkeletonHeader,
  SkeletonStatRow,
  SkeletonCard,
  SkeletonChart,
  SkeletonTable,
  Stat,
  StatusBadge,
  TableWrap,
  tdClass,
  thClass,
} from '@/components/ui';
import { EquityChart } from '@/components/equity-chart';
import { ConnectWizard } from '@/components/connect-wizard';
import { DirectionTag } from '@/components/trade-bits';

interface AccountDetail {
  account: AccountDto;
  detail: {
    credit: number | null;
    terminalBuild: string | null;
    pairedAt: string | null;
    agentLastSeenAt: string | null;
  };
  positions: PositionDto[];
}

export default function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { accounts } = useLiveData();

  const [data, setData] = useState<AccountDetail | null>(null);
  const [stats, setStats] = useState<AccountStatsDto | null>(null);
  const [pairing, setPairing] = useState<PairingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, statsData] = await Promise.all([
        get<AccountDetail>(`/accounts/${id}`),
        get<{ stats: AccountStatsDto }>(`/analytics/accounts/${id}/stats`).catch(() => null),
      ]);
      setData(detail);
      if (statsData) setStats(statsData.stats);
    } catch {
      setError('This account could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The live feed is the source of truth for figures that change every second;
  // the fetched detail supplies the rest.
  const live = accounts.find((a) => a.id === id);
  const account = live ?? data?.account;

  useEffect(() => {
    // Refresh open positions when the live count changes under us.
    if (!live || !data) return;
    if (live.openPositions !== data.positions.length) void load();
  }, [live?.openPositions, live, data, load]);

  if (loading) {
    return (
      <SkeletonScreen label="Loading account">
        <SkeletonHeader />
        <SkeletonStatRow count={8} />
        <SkeletonTable columns={8} rows={4} />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <SkeletonChart />
          <SkeletonCard rows={8} />
        </div>
      </SkeletonScreen>
    );
  }
  if (error || !account) return <Alert tone="error">{error ?? 'Account not found.'}</Alert>;

  const floating = data?.positions.reduce((sum, p) => sum + p.profit, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={account.name}
        description={`${account.platform} · ${account.broker ?? 'Unknown broker'} · ${account.accountNumber}${
          account.server ? ` · ${account.server}` : ''
        }`}
        actions={
          <>
            {account.role === 'FOLLOWER' ? (
              <Link href="/copier">
                <Button variant="secondary">Copy settings</Button>
              </Link>
            ) : null}
            <Button
              variant="secondary"
              onClick={async () => {
                const result = await post<{ pairing: PairingDto }>(`/accounts/${id}/pairing-code`);
                setPairing(result.pairing);
              }}
            >
              {account.paired ? 'Re-pair terminal' : 'Get pairing code'}
            </Button>
          </>
        }
      />

      {pairing ? (
        <div className="mb-6">
          <ConnectWizard pairing={pairing} platform={account.platform} accountName={account.name} />
        </div>
      ) : null}

      {!account.paired && !pairing ? (
        <Alert tone="warning" title="No terminal connected yet">
          This account has no agent attached, so TradeOS cannot see or place trades on it. Generate a
          pairing code and attach the agent in MetaTrader.
        </Alert>
      ) : null}

      {account.lastError ? (
        <div className="mt-4">
          <Alert tone="error" title="Last reported problem">
            {account.lastError}
          </Alert>
        </div>
      ) : null}

      {/* PRD 10: full account figures */}
      <Card className="my-6">
        <div className="mb-4 flex items-center justify-between">
          <StatusBadge status={account.status} />
          <span className="text-xs text-slate-500">
            Last heartbeat {formatAge(account.heartbeatAgeSeconds)}
            {account.agentVersion ? ` · agent v${account.agentVersion}` : ''}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Balance">{formatMoney(account.balance, account.currency)}</Stat>
          <Stat label="Equity">{formatMoney(account.equity, account.currency)}</Stat>
          <Stat label="Free margin">{formatMoney(account.freeMargin, account.currency)}</Stat>
          <Stat label="Margin">{formatMoney(account.margin, account.currency)}</Stat>
          <Stat label="Margin level">{formatPercent(account.marginLevel)}</Stat>
          <Stat label="Floating P/L">
            <Money value={account.floatingPl ?? floating} currency={account.currency} signed />
          </Stat>
          <Stat label="Realised today">
            <Money value={account.todayPl} currency={account.currency} signed />
          </Stat>
          <Stat label="Realised total">
            <Money value={account.totalPl} currency={account.currency} signed />
          </Stat>
        </div>
      </Card>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Open positions ({data?.positions.length ?? 0})
        </h2>

        {!data || data.positions.length === 0 ? (
          <EmptyState title="No open positions" />
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={thClass}>Symbol</th>
                  <th className={thClass}>Direction</th>
                  <th className={thClass}>Lots</th>
                  <th className={thClass}>Entry</th>
                  <th className={thClass}>Current</th>
                  <th className={thClass}>SL</th>
                  <th className={thClass}>TP</th>
                  <th className={thClass}>P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.positions.map((position) => (
                  <tr key={position.id}>
                    <td className={`${tdClass} font-medium`}>{position.symbol}</td>
                    <td className={tdClass}>
                      <DirectionTag direction={position.direction} />
                    </td>
                    <td className={tdClass}>{formatLots(position.volume)}</td>
                    <td className={tdClass}>{formatPrice(position.openPrice)}</td>
                    <td className={tdClass}>{formatPrice(position.currentPrice)}</td>
                    <td className={tdClass}>{position.stopLoss ? formatPrice(position.stopLoss) : '—'}</td>
                    <td className={tdClass}>{position.takeProfit ? formatPrice(position.takeProfit) : '—'}</td>
                    <td className={tdClass}>
                      <Money value={position.profit} currency={account.currency} signed />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Equity curve
          </h2>
          <Card>
            <EquityChart accountId={id} />
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Statistics
          </h2>
          <Card>
            {stats && stats.totalTrades > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Row label="Total trades" value={String(stats.totalTrades)} />
                <Row label="Win rate" value={formatPercent(stats.winRate)} />
                <Row label="Winning trades" value={String(stats.winningTrades)} />
                <Row label="Losing trades" value={String(stats.losingTrades)} />
                <Row label="Gross profit" value={formatMoney(stats.grossProfit)} />
                <Row label="Gross loss" value={formatMoney(stats.grossLoss)} />
                <Row label="Net profit" value={formatMoney(stats.netProfit, 'USD', { signed: true })} />
                <Row label="Profit factor" value={stats.profitFactor?.toFixed(2) ?? '—'} />
                <Row label="Average win" value={formatMoney(stats.averageWin)} />
                <Row label="Average loss" value={formatMoney(stats.averageLoss)} />
                <Row label="Largest win" value={formatMoney(stats.largestWin)} />
                <Row label="Largest loss" value={formatMoney(stats.largestLoss)} />
                <Row label="Average trade" value={formatMoney(stats.averageTrade, 'USD', { signed: true })} />
                <Row label="Max drawdown" value={`${formatMoney(stats.maxDrawdown)} (${formatPercent(stats.maxDrawdownPercent)})`} />
              </dl>
            ) : (
              <p className="py-8 text-center text-sm text-slate-500">
                Statistics appear once this account has closed trades.
              </p>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
