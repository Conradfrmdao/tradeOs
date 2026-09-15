'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { PositionDto } from '@tradeos/shared';
import { formatDateTime, formatLots, formatMoney, formatPrice } from '@tradeos/shared';
import { get } from '@/lib/api';
import { useLiveData } from '@/lib/live-data';
import {
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

interface OpenTradesResponse {
  items: PositionDto[];
  total: number;
  totals: { floatingPl: number; swap: number; commission: number; volume: number };
}

export default function OpenTradesPage() {
  const { portfolio, accounts } = useLiveData();

  const [scope, setScope] = useState<'all' | 'master' | 'followers'>('all');
  const [direction, setDirection] = useState<'' | 'BUY' | 'SELL'>('');
  const [pnl, setPnl] = useState<'all' | 'profitable' | 'losing'>('all');
  const [symbol, setSymbol] = useState('');
  const [data, setData] = useState<OpenTradesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ scope, pnl, pageSize: '200' });
    if (direction) query.set('direction', direction);
    if (symbol.trim()) query.set('symbol', symbol.trim());

    try {
      setData(await get<OpenTradesResponse>(`/trades/open?${query}`));
    } finally {
      setLoading(false);
    }
  }, [scope, direction, pnl, symbol]);

  useEffect(() => {
    void load();
  }, [load]);

  // Open positions move with the market; refresh whenever the live portfolio
  // count changes rather than polling on a timer.
  useEffect(() => {
    void load();
  }, [portfolio?.openPositions, load]);

  if (loading && !data) return <Spinner label="Loading open trades" />;

  return (
    <>
      <PageHeader
        title="Open trades"
        description={`${data?.total ?? 0} open across ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`}
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterGroup
            label="Accounts"
            value={scope}
            onChange={(v) => setScope(v as typeof scope)}
            options={[
              ['all', 'All'],
              ['master', 'Master'],
              ['followers', 'Followers'],
            ]}
          />
          <FilterGroup
            label="Direction"
            value={direction}
            onChange={(v) => setDirection(v as typeof direction)}
            options={[
              ['', 'Both'],
              ['BUY', 'Buy'],
              ['SELL', 'Sell'],
            ]}
          />
          <FilterGroup
            label="Result"
            value={pnl}
            onChange={(v) => setPnl(v as typeof pnl)}
            options={[
              ['all', 'All'],
              ['profitable', 'Profitable'],
              ['losing', 'Losing'],
            ]}
          />
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Symbol
            </span>
            <input
              className={cx(inputClass, 'w-40')}
              placeholder="e.g. EURUSD"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
          </label>
        </div>
      </Card>

      {!data || data.items.length === 0 ? (
        <EmptyState
          title="No open trades match these filters"
          description="Trades appear here the moment your terminals report them."
        />
      ) : (
        <>
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className={thClass}>Account</th>
                  <th className={thClass}>Symbol</th>
                  <th className={thClass}>Direction</th>
                  <th className={thClass}>Lots</th>
                  <th className={thClass}>Entry</th>
                  <th className={thClass}>Current</th>
                  <th className={thClass}>SL</th>
                  <th className={thClass}>TP</th>
                  <th className={thClass}>Floating P/L</th>
                  <th className={thClass}>Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((position) => (
                  <tr key={position.id} className="hover:bg-slate-50">
                    <td className={tdClass}>
                      <Link href={`/accounts/${position.accountId}`} className="underline">
                        {position.accountName}
                      </Link>
                      {position.masterPositionId ? (
                        <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">
                          copied
                        </span>
                      ) : null}
                    </td>
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
                      <Money value={position.profit} signed />
                    </td>
                    <td className={`${tdClass} text-xs text-slate-500`}>
                      {formatDateTime(position.openTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td className={`${tdClass} font-semibold`} colSpan={3}>
                    Totals ({data.total} trades)
                  </td>
                  <td className={`${tdClass} font-semibold`}>{formatLots(data.totals.volume)}</td>
                  <td className={tdClass} colSpan={4} />
                  <td className={`${tdClass} font-semibold`}>
                    <Money value={data.totals.floatingPl} signed />
                  </td>
                  <td className={tdClass} />
                </tr>
              </tfoot>
            </table>
          </TableWrap>

          <p className="mt-3 text-xs text-slate-500">
            Swap {formatMoney(data.totals.swap)} · Commission {formatMoney(data.totals.commission)}.
            Totals cover every trade matching the filters, not just this page.
          </p>
        </>
      )}
    </>
  );
}
