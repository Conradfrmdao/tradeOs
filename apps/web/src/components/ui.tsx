'use client';

import type { AccountStatus } from '@tradeos/shared';
import { formatMoney } from '@tradeos/shared';

/** Small shared primitives. Deliberately plain — no component library. */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * A profit/loss figure, coloured by sign.
 *
 * Colour alone never carries the meaning: the sign is always printed too, so
 * the value is readable for colour-blind users and in greyscale.
 */
export function Money({
  value,
  currency = 'USD',
  signed = false,
  className,
}: {
  value: number | null | undefined;
  currency?: string;
  signed?: boolean;
  className?: string;
}) {
  const tone =
    !signed || value == null || value === 0
      ? 'text-slate-900'
      : value > 0
        ? 'text-profit'
        : 'text-loss';

  return (
    <span className={cx('tabular-nums', tone, className)}>
      {formatMoney(value, currency, { signed })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<AccountStatus, { dot: string; text: string; label: string }> = {
  CONNECTED: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Connected' },
  CONNECTING: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-700', label: 'Connecting' },
  PENDING: { dot: 'bg-slate-400', text: 'text-slate-600', label: 'Waiting for agent' },
  DISCONNECTED: { dot: 'bg-red-500', text: 'text-red-700', label: 'Disconnected' },
  ERROR: { dot: 'bg-red-600', text: 'text-red-700', label: 'Error' },
  DISABLED: { dot: 'bg-slate-300', text: 'text-slate-500', label: 'Disabled' },
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm font-medium', style.text)}>
      <span className={cx('h-2 w-2 rounded-full', style.dot)} aria-hidden />
      {style.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  children,
  hint,
  size = 'lg',
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  /** `sm` for stats inside a narrow card, where a full-size figure would
   *  collide with the one beside it. */
  size?: 'sm' | 'lg';
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={cx(
          'mt-1 truncate font-semibold tabular-nums',
          size === 'sm' ? 'text-lg' : 'text-2xl',
        )}
      >
        {children}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_STYLES[variant],
        className,
      )}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-sm text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm ' +
  'focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 ' +
  'disabled:bg-slate-50 disabled:text-slate-500';

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2',
        checked ? 'bg-emerald-600' : 'bg-slate-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cx(
          'inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: 'border-slate-200 bg-slate-50 text-slate-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
  }[tone];

  return (
    <div className={cx('rounded-lg border px-4 py-3 text-sm', styles)} role="alert">
      {title ? <div className="font-semibold">{title}</div> : null}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-slate-900">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Loading placeholders.
 *
 * Preferred over a spinner because they hold the shape of what is coming: the
 * page does not jump when data lands, and a trader glancing at the screen can
 * already see where the balance and the positions will be. `aria-hidden` keeps
 * the decoration out of the accessibility tree; the surrounding region carries
 * the live status instead.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded bg-slate-200/70', className)} />;
}

/** Wraps a skeleton screen so assistive tech announces loading once. */
export function SkeletonScreen({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonStatRow({ count = 6 }: { count?: number }) {
  return (
    <Card className="mb-6">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-28" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="w-full">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-52" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-1.5 h-5 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-28" />
      </div>
    </Card>
  );
}

export function SkeletonTable({
  columns = 6,
  rows = 6,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <TableWrap>
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className={thClass}>
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c} className={tdClass}>
                  {/* Vary the width so it reads as content, not a grid. */}
                  <Skeleton className={cx('h-4', c === 0 ? 'w-36' : c % 3 === 0 ? 'w-16' : 'w-20')} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="p-0">
      <ol className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex gap-3 px-4 py-3">
            <Skeleton className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-full max-w-[16rem]" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function SkeletonChart() {
  return (
    <Card>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-5 h-7 w-40" />
      <Skeleton className="mt-4 h-56 w-full rounded-lg" />
    </Card>
  );
}

export function SkeletonHeader() {
  return (
    <div className="mb-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800"
        aria-hidden
      />
      {label}
    </div>
  );
}

/** Horizontal scroll container so wide tables never break the page layout. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">{children}</div>;
}

export const thClass =
  'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
export const tdClass = 'whitespace-nowrap px-4 py-3 text-sm text-slate-800';
