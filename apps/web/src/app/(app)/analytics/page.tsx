'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AccountStatsDto, TradeStats } from '@tradeos/shared';
import { formatMoney, formatPercent } from '@tradeos/shared';
import { get } from '@/lib/api';
import {
  Card,
  EmptyState,
  Money,
  PageHeader,
  Spinner,
  Stat,
  TableWrap,
  tdClass,
  thClass,
} from '@/components/ui';
import { EquityChart } from '@/components/equity-chart';

interface PortfolioAnalytics {
  stats: TradeStats;
  todayPl: number;
  weekPl: number;
  monthPl: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  accounts: AccountStatsDto[];
}

interface ComparisonRow {
  accountId: string;
  accountName: string;
  role: 'MASTER' | 'FOLLOWER';
  balance: number;
  equity: number;
  netProfit: number;
  winRate: number;
  profitFactor: number | null;
  totalTrades: number;
  maxDrawdownPercent: number;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<PortfolioAnalytics | null>(null);
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [analytics, comparison] = await Promise.all([
          get<PortfolioAnalytics>('/analytics/portfolio'),
          get<{ rows: ComparisonRow[] }>('/analytics/comparison'),
        ]);
        setData(analytics);
        setRows(comparison.rows);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner label="Crunching your numbers" />;
  if (!data) return <EmptyState title="No analytics available yet" />;

  const { stats } = data;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Combined performance across every connected account."
      />

      {/* PRD 22: portfolio statistics */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Today">
            <Money value={data.todayPl} signed />
          </Stat>
          <Stat label="This week">
            <Money value={data.weekPl} signed />
          </Stat>
          <Stat label="This month">
            <Money value={data.monthPl} signed />
          </Stat>
          <Stat label="Total trades">{stats.totalTrades}</Stat>
          <Stat label="Win rate">{formatPercent(stats.winRate)}</Stat>
          <Stat label="Profit factor">{stats.profitFactor?.toFixed(2) ?? '—'}</Stat>
        </div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Portfolio equity
          </h2>
          <EquityChart />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Risk &amp; results
          </h2>
          {stats.totalTrades === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Figures appear once your accounts have closed trades.
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <Row label="Net profit" value={formatMoney(stats.netProfit, 'USD', { signed: true })} />
              <Row label="Gross profit" value={formatMoney(stats.grossProfit)} />
              <Row label="Gross loss" value={formatMoney(stats.grossLoss)} />
              <Row label="Winning trades" value={String(stats.winningTrades)} />
              <Row label="Losing trades" value={String(stats.losingTrades)} />
              <Row label="Average win" value={formatMoney(stats.averageWin)} />
              <Row label="Average loss" value={formatMoney(stats.averageLoss)} />
              <Row label="Largest win" value={formatMoney(stats.largestWin)} />
              <Row label="Largest loss" value={formatMoney(stats.largestLoss)} />
              <Row label="Average trade" value={formatMoney(stats.averageTrade, 'USD', { signed: true })} />
              <Row
                label="Max drawdown"
                value={`${formatMoney(data.maxDrawdown)} (${formatPercent(data.maxDrawdownPercent)})`}
              />
            </dl>
          )}
        </Card>
      </div>

      {/* PRD 23: account comparison */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Account comparison
        </h2>

        {rows.length === 0 ? (
          <EmptyState title="Nothing to compare yet" />
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={thClass}>Account</th>
                  <th className={thClass}>Role</th>
                  <th className={thClass}>Balance</th>
                  <th className={thClass}>Equity</th>
                  <th className={thClass}>Net P/L</th>
                  <th className={thClass}>Trades</th>
                  <th className={thClass}>Win rate</th>
                  <th className={thClass}>Profit factor</th>
                  <th className={thClass}>Max drawdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.accountId} className="hover:bg-slate-50">
                    <td className={tdClass}>
                      <Link href={`/accounts/${row.accountId}`} className="font-medium underline">
                        {row.accountName}
                      </Link>
                    </td>
                    <td className={tdClass}>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                        {row.role}
                      </span>
                    </td>
                    <td className={tdClass}>{formatMoney(row.balance)}</td>
                    <td className={tdClass}>{formatMoney(row.equity)}</td>
                    <td className={tdClass}>
                      <Money value={row.netProfit} signed />
                    </td>
                    <td className={tdClass}>{row.totalTrades}</td>
                    <td className={tdClass}>{formatPercent(row.winRate)}</td>
                    <td className={tdClass}>{row.profitFactor?.toFixed(2) ?? '—'}</td>
                    <td className={tdClass}>{formatPercent(row.maxDrawdownPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
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
