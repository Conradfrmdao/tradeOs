'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { formatAge } from '@tradeos/shared';
import { useRequireAuth } from '@/lib/session';
import { LiveDataProvider, useLiveData } from '@/lib/live-data';
import { Alert, Button, Spinner, cx } from '@/components/ui';
import { post } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/copier', label: 'Copier' },
  { href: '/trades', label: 'Open Trades' },
  { href: '/history', label: 'Trade History' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
];

const ADMIN_NAV = [
  { href: '/admin', label: 'Admin Dashboard' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/accounts', label: 'Accounts' },
  { href: '/admin/logs', label: 'System Logs' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth();

  if (loading) return <Spinner label="Loading your dashboard" />;
  if (!user) return null; // useRequireAuth is redirecting

  return (
    <LiveDataProvider>
      <Shell>{children}</Shell>
    </LiveDataProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useRequireAuth();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="min-h-screen lg:flex">
      {/* Mobile header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="font-bold">
          TradeOS
        </Link>
        <Button variant="secondary" onClick={() => setNavOpen((v) => !v)} aria-expanded={navOpen}>
          {navOpen ? 'Close' : 'Menu'}
        </Button>
      </header>

      <nav
        className={cx(
          'border-b border-slate-200 bg-white px-3 py-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r',
          navOpen ? 'block' : 'hidden lg:block',
        )}
      >
        <Link href="/dashboard" className="mb-6 hidden px-3 text-lg font-bold lg:block">
          TradeOS
        </Link>

        <ul className="space-y-1">
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} pathname={pathname} onNavigate={() => setNavOpen(false)} />
          ))}
        </ul>

        {isAdmin ? (
          <>
            <div className="mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Admin
            </div>
            <ul className="mt-2 space-y-1">
              {ADMIN_NAV.map((item) => (
                <NavLink key={item.href} {...item} pathname={pathname} onNavigate={() => setNavOpen(false)} exact />
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-8 border-t border-slate-200 px-3 pt-4">
          <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
          <button
            onClick={() => void signOut()}
            className="mt-3 text-sm text-slate-600 underline hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <TopBanners />
          {children}
        </div>
      </main>
    </div>
  );
}

function NavLink({
  href,
  label,
  pathname,
  onNavigate,
  exact,
}: {
  href: string;
  label: string;
  pathname: string;
  onNavigate: () => void;
  exact?: boolean;
}) {
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
        )}
      >
        {label}
      </Link>
    </li>
  );
}

/**
 * Two things the user must never miss: a dead realtime connection, and an
 * unverified email blocking account setup.
 */
function TopBanners() {
  const { connection, portfolio, accounts } = useLiveData();
  const { user, refresh } = useRequireAuth();
  const [resent, setResent] = useState(false);

  const stale = accounts.filter(
    (a) => a.status === 'DISCONNECTED' || a.status === 'ERROR',
  );

  return (
    <div className="mb-4 space-y-3 empty:mb-0">
      {connection !== 'open' ? (
        <Alert tone="warning" title="Live updates are offline">
          The figures below may be out of date. Reconnecting automatically…
        </Alert>
      ) : null}

      {user && !user.emailVerified ? (
        <Alert tone="warning" title="Verify your email">
          <div className="flex flex-wrap items-center gap-3">
            <span>You need a verified email address before you can connect trading accounts.</span>
            <Button
              variant="secondary"
              onClick={async () => {
                await post('/auth/resend-verification').catch(() => undefined);
                await refresh();
                setResent(true);
              }}
            >
              {resent ? 'Sent — check your inbox' : 'Resend verification email'}
            </Button>
          </div>
        </Alert>
      ) : null}

      {portfolio?.emergencyStopAt ? (
        <Alert tone="error" title="Emergency stop is active">
          All copying is switched off. Turn it back on from the{' '}
          <Link href="/copier" className="underline">
            Copier page
          </Link>{' '}
          when you are ready.
        </Alert>
      ) : null}

      {stale.length > 0 ? (
        <Alert tone="error" title={`${stale.length} account${stale.length === 1 ? '' : 's'} offline`}>
          {stale
            .map((a) => `${a.name} (last seen ${formatAge(a.heartbeatAgeSeconds)})`)
            .join(', ')}
          . No trades can be copied to or from an offline account.
        </Alert>
      ) : null}
    </div>
  );
}
