'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PositionDto } from '@tradeos/shared';
import { formatDateTime, formatLots, formatMoney, formatPrice } from '@tradeos/shared';
import { get } from '@/lib/api';
import {
  Button,
  Card,
  EmptyState,
  Money,
  PageHeader,
  Spinner,
  TableWrap,
  cx,
  inputClass,
  tdClass,
  thClass,
} from '@/components/ui';
import { DirectionTag, FilterGroup } from '@/components/trade-bits';

interface HistoryResponse {
  items: PositionDto[];
  page: number;
  totalPages: number;
  total: number;
  totals: { profit: number; swap: number; commission: number; netProfit: number; volume: number };
}

type SortBy = 'closeTime' | 'openTime' | 'netProfit' | 'symbol';

export default function HistoryPage() {
  const [scope, setScope] = useState<'all' | 'master' | 'followers'>('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('closeTime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({
      scope,
      sortBy,
      sortDir,
      page: String(page),
      pageSize: '50',
    });
    if (search.trim()) query.set('search', search.trim());
    // Dates arrive as YYYY-MM-DD; the API wants full instants.
    if (from) query.set('from', new Date(`${from}T00:00:00Z`).toISOString());
    if (to) query.set('to', new Date(`${to}T23:59:59Z`).toISOString());

    try {
      setData(await get<HistoryResponse>(`/trades/history?${query}`));
    } finally {
      setLoading(false);
    }
  }, [scope, search, from, to, sortBy, sortDir, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function sort(column: SortBy) {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
    setPage(1);
  }

  return (
    <>
      <PageHeader title="Trade history" description={`${data?.total ?? 0} closed trades.`} />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterGroup
            label="Accounts"
            value={scope}
            onChange={(v) => {
              setScope(v as typeof scope);
              setPage(1);
            }}
            options={[
              ['all', 'All'],
              ['master', 'Master'],
              ['followers', 'Followers'],
            ]}
          />

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Search
            </span>
            <input
              className={cx(inputClass, 'w-48')}
              placeholder="Symbol, ticket or comment"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              From
            </span>
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              To
            </span>
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </Card>

      {loading && !data ? (
        <Spinner label="Loading history" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No closed trades yet"
          description="Closed trades are imported from each terminal as they happen."
        />
      ) : (
        <>
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={thClass}>Account</th>
                  <th className={thClass}>Ticket</th>
                  <SortHeader label="Symbol" column="symbol" sortBy={sortBy} sortDir={sortDir} onSort={sort} />
                  <th className={thClass}>Direction</th>
                  <th className={thClass}>Lots</th>
                  <th className={thClass}>Open</th>
                  <th className={thClass}>Close</th>
                  <SortHeader label="Opened" column="openTime" sortBy={sortBy} sortDir={sortDir} onSort={sort} />
                  <SortHeader label="Closed" column="closeTime" sortBy={sortBy} sortDir={sortDir} onSort={sort} />
                  <th className={thClass}>Profit</th>
                  <th className={thClass}>Swap</th>
                  <th className={thClass}>Comm.</th>
                  <SortHeader label="Net" column="netProfit" sortBy={sortBy} sortDir={sortDir} onSort={sort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((trade) => (
                  <tr key={trade.id} className="hover:bg-slate-50">
                    <td className={tdClass}>{trade.accountName}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{trade.ticket}</td>
                    <td className={`${tdClass} font-medium`}>{trade.symbol}</td>
                    <td className={tdClass}>
                      <DirectionTag direction={trade.direction} />
                    </td>
                    <td className={tdClass}>{formatLots(trade.volume)}</td>
                    <td className={tdClass}>{formatPrice(trade.openPrice)}</td>
                    <td className={tdClass}>{formatPrice(trade.closePrice)}</td>
                    <td className={`${tdClass} text-xs text-slate-500`}>{formatDateTime(trade.openTime)}</td>
                    <td className={`${tdClass} text-xs text-slate-500`}>{formatDateTime(trade.closeTime)}</td>
                    <td className={tdClass}>
                      <Money value={trade.profit} signed />
                    </td>
                    <td className={tdClass}>{formatMoney(trade.swap)}</td>
                    <td className={tdClass}>{formatMoney(trade.commission)}</td>
                    <td className={`${tdClass} font-semibold`}>
                      <Money value={trade.netProfit} signed />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td className={`${tdClass} font-semibold`} colSpan={4}>
                    Totals ({data.total} trades)
                  </td>
                  <td className={`${tdClass} font-semibold`}>{formatLots(data.totals.volume)}</td>
                  <td className={tdClass} colSpan={4} />
                  <td className={`${tdClass} font-semibold`}>
                    <Money value={data.totals.profit} signed />
                  </td>
                  <td className={`${tdClass} font-semibold`}>{formatMoney(data.totals.swap)}</td>
                  <td className={`${tdClass} font-semibold`}>{formatMoney(data.totals.commission)}</td>
                  <td className={`${tdClass} font-semibold`}>
                    <Money value={data.totals.netProfit} signed />
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>

          {data.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-slate-600">
                Page {data.page} of {data.totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function SortHeader({
  label,
  column,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  column: SortBy;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  onSort: (column: SortBy) => void;
}) {
  const active = sortBy === column;
  return (
    <th className={thClass} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(column)} className="inline-flex items-center gap-1 hover:text-slate-900">
        {label}
        <span aria-hidden className={active ? 'text-slate-900' : 'text-slate-300'}>
          {active && sortDir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}
