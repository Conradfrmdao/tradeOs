'use client';

import { cx } from './ui';

/**
 * Small pieces shared by the trade tables.
 *
 * They live here rather than in a page because Next.js route files may only
 * export the default component and a fixed set of route options.
 */

export function DirectionTag({ direction }: { direction: 'BUY' | 'SELL' }) {
  return (
    <span
      className={
        direction === 'BUY'
          ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800'
          : 'rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800'
      }
    >
      {direction}
    </span>
  );
}

/** Segmented control used by the trade and history filters. */
export function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label={label}>
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
            className={cx(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              value === optionValue ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
