'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChartRange, EquityPointDto } from '@tradeos/shared';
import { CHART_RANGES, CHART_RANGE_LABELS, formatMoney } from '@tradeos/shared';
import { get } from '@/lib/api';
import { cx } from './ui';

/**
 * Equity curve (PRD 21).
 *
 * Hand-drawn SVG rather than a charting library: the shape is a single
 * polyline, and avoiding a dependency keeps the bundle small and the page
 * free of the canvas/eval machinery a strict CSP would have to allow.
 */
export function EquityChart({ accountId }: { accountId?: string }) {
  const [range, setRange] = useState<ChartRange>('30d');
  const [points, setPoints] = useState<EquityPointDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const query = new URLSearchParams({ range });
    if (accountId) query.set('accountId', accountId);

    get<{ points: EquityPointDto[] }>(`/analytics/equity?${query}`, controller.signal)
      .then((data) => setPoints(data.points))
      .catch(() => undefined)
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [range, accountId]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {CHART_RANGES.map((option) => (
          <button
            key={option}
            onClick={() => setRange(option)}
            className={cx(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              range === option ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {CHART_RANGE_LABELS[option]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center text-sm text-slate-500">
          Loading chart…
        </div>
      ) : points.length < 2 ? (
        <div className="flex h-56 items-center justify-center px-4 text-center text-sm text-slate-500">
          Not enough data yet. The curve builds up as your accounts report equity.
        </div>
      ) : (
        <Curve points={points} />
      )}
    </div>
  );
}

const WIDTH = 800;
const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 24, left: 88 };

const AXIS_TICKS = [0, 0.5, 1];

/**
 * Picks the least verbose axis format that still tells the gridlines apart.
 *
 * Compact notation ("$185K") is the nicest to read, but it collapses when the
 * visible range is small next to the balance — a $300 swing on a $185,000
 * account renders every gridline as "$185K", which is worse than useless on a
 * chart whose whole job is showing that swing. So the labels are generated,
 * checked for collisions, and stepped up in precision until they are distinct.
 */
function pickAxisFormat(values: number[]): (value: number) => string {
  const candidates: Intl.NumberFormatOptions[] = [
    { notation: 'compact', maximumFractionDigits: 1 },
    { notation: 'standard', maximumFractionDigits: 0 },
    { notation: 'standard', minimumFractionDigits: 2, maximumFractionDigits: 2 },
  ];

  for (const options of candidates) {
    const format = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      ...options,
    });
    const rendered = values.map((v) => format.format(v));
    if (new Set(rendered).size === rendered.length) {
      return (value: number) => format.format(value);
    }
  }

  // Every candidate collided, which means the range is genuinely flat.
  const last = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (value: number) => last.format(value);
}

function Curve({ points }: { points: EquityPointDto[] }) {
  const geometry = useMemo(() => {
    const values = points.map((p) => p.equity);
    let min = Math.min(...values);
    let max = Math.max(...values);

    // A flat series would divide by zero and draw nothing; give it some room.
    if (min === max) {
      min -= Math.abs(min) * 0.01 || 1;
      max += Math.abs(max) * 0.01 || 1;
    } else {
      // Breathing room so the line never sits on the frame.
      const padding = (max - min) * 0.08;
      min -= padding;
      max += padding;
    }

    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;

    const x = (index: number) =>
      PAD.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
    const y = (value: number) => PAD.top + plotH - ((value - min) / (max - min)) * plotH;

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(2)},${PAD.top + plotH} L${x(0).toFixed(2)},${PAD.top + plotH} Z`;

    const axisLabel = pickAxisFormat(AXIS_TICKS.map((t) => max - (max - min) * t));

    return { line, area, min, max, plotH, axisLabel };
  }, [points]);

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const change = last.equity - first.equity;
  const rising = change >= 0;
  const stroke = rising ? '#059669' : '#dc2626';

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="text-lg font-semibold tabular-nums">{formatMoney(last.equity)}</span>
        <span className={cx('tabular-nums font-medium', rising ? 'text-profit' : 'text-loss')}>
          {rising ? '+' : ''}
          {formatMoney(change)} over this period
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-56 w-full"
        role="img"
        aria-label={`Equity curve, ${formatMoney(first.equity)} to ${formatMoney(last.equity)}`}
      >
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines with value labels, so the shape can be read as numbers. */}
        {AXIS_TICKS.map((t) => {
          const y = PAD.top + geometry.plotH * t;
          const value = geometry.max - (geometry.max - geometry.min) * t;
          return (
            <g key={t}>
              <line x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[11px]">
                {geometry.axisLabel(value)}
              </text>
            </g>
          );
        })}

        <path d={geometry.area} fill="url(#equityFill)" />
        <path
          d={geometry.line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <text x={PAD.left} y={HEIGHT - 6} className="fill-slate-400 text-[11px]">
          {new Date(first.at).toLocaleDateString()}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-slate-400 text-[11px]">
          {new Date(last.at).toLocaleDateString()}
        </text>
      </svg>
    </figure>
  );
}
