'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

/**
 * Floating bottom navigation for phones.
 *
 * Carries the four screens a trader moves between while watching positions,
 * within thumb reach rather than behind a menu button in the top corner.
 *
 * "More" opens only what is *not* already here — repeating the four would make
 * the sheet mostly redundant and hide the two screens it exists to reach.
 * Settings and the account menu live in the header instead, where destructive
 * and account-level actions are out of the way of one-handed navigation.
 */

export const PILL_ITEMS = [
  { href: '/dashboard', label: 'Home', icon: HomeIcon },
  { href: '/accounts', label: 'Accounts', icon: AccountsIcon },
  { href: '/copier', label: 'Copier', icon: CopierIcon },
  { href: '/trades', label: 'Trades', icon: TradesIcon },
] as const;

/** Paths the pill already covers, so the sheet can exclude them. */
export const PILL_HREFS: readonly string[] = PILL_ITEMS.map((i) => i.href);

export function MobileNav({
  onMore,
  moreOpen,
}: {
  onMore: () => void;
  moreOpen: boolean;
}) {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 lg:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex w-full max-w-md items-stretch gap-0.5 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur">
        {PILL_ITEMS.map((item) => {
          const active =
            !moreOpen && (pathname === item.href || pathname.startsWith(`${item.href}/`));
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
          aria-expanded={moreOpen}
          className={cx(
            'flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors',
            moreOpen ? 'bg-slate-900 text-white' : 'text-slate-600 active:bg-slate-100',
          )}
        >
          <MoreIcon />
          More
        </button>
      </div>
    </nav>
  );
}

/** Space so the floating bar never covers the end of the page. */
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
// Icons — inline, so the bundle carries no icon library for a handful of glyphs.
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

export function SettingsIcon() {
  return (
    <svg {...svg} width={22} height={22}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
