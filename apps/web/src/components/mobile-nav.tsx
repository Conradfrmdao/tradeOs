'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

/**
 * Floating bottom navigation for phones.
 *
 * The five destinations a trader actually moves between while watching
 * positions, kept within thumb reach instead of behind a menu button at the
 * top of the screen. Anything else lives under "More".
 *
 * It floats above a safe-area inset so it clears the home indicator on
 * gesture-driven phones, and the page reserves matching space so the last row
 * of a table is never trapped underneath it.
 */

const ITEMS = [
  { href: '/dashboard', label: 'Home', icon: HomeIcon },
  { href: '/accounts', label: 'Accounts', icon: AccountsIcon },
  { href: '/copier', label: 'Copier', icon: CopierIcon },
  { href: '/trades', label: 'Trades', icon: TradesIcon },
] as const;

export function MobileNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 lg:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex w-full max-w-md items-stretch gap-0.5 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors',
                active ? 'bg-slate-900 text-white' : 'text-slate-600 active:bg-slate-100',
              )}
            >
              <Icon />
              {item.label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onMore}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium text-slate-600 transition-colors active:bg-slate-100"
        >
          <MoreIcon />
          More
        </button>
      </div>
    </nav>
  );
}

/** Space so a floating bar never covers the end of the page. */
export function MobileNavSpacer() {
  return (
    <div
      aria-hidden
      className="lg:hidden"
      style={{ height: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Icons — inline so the bundle carries no icon library for five glyphs.
// ---------------------------------------------------------------------------

const svg = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function HomeIcon() {
  return (
    <svg {...svg}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function AccountsIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function CopierIcon() {
  return (
    <svg {...svg}>
      <path d="M7 7h10l-3-3" />
      <path d="M17 17H7l3 3" />
    </svg>
  );
}

function TradesIcon() {
  return (
    <svg {...svg}>
      <path d="M3 17l5-6 4 3 5-8" />
      <path d="M17 6h4v4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...svg}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}
