'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { formatAge } from '@tradeos/shared';
import { useRequireAuth } from '@/lib/session';
import { LiveDataProvider, useLiveData } from '@/lib/live-data';
import { Alert, Button, Spinner, cx } from '@/components/ui';
import { post } from '@/lib/api';
import { UserButton } from '@clerk/nextjs';

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
  const { user, loading, mismatch, refresh } = useRequireAuth();

  if (loading) return <Spinner label="Loading your dashboard" />;

  // Signed in with Clerk, but the API will not accept the session. Sending the
  // user back to sign-in here is what caused an infinite redirect loop, since
  // Clerk immediately returns an already-authenticated user to the dashboard.
  if (!user && mismatch) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <Alert tone="error" title="Signed in, but we could not load your account">
          Your sign-in worked, but the TradeOS API did not accept the session. This is a problem on
          our side, not something you did wrong.
        </Alert>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => void refresh()}>Try again</Button>
          <Link href="/sign-in">
            <Button variant="secondary">Back to sign in</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!user) return null; // genuinely signed out — useRequireAuth is redirecting

  return (
    <LiveDataProvider>
      <Shell>{children}</Shell>
    </LiveDataProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useRequireAuth();
  // usePathname() is typed as possibly null alongside a pages/ directory.
  const pathname = usePathname() ?? '';
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
          'border-b border-slate-200 bg-white px-3 py-4 lg:flex lg:h-screen lg:w-60 lg:shrink-0',
          'lg:sticky lg:top-0 lg:flex-col lg:border-b-0 lg:border-r',
          navOpen ? 'block' : 'hidden lg:flex',
        )}
      >
        <Link href="/dashboard" className="mb-6 hidden px-3 text-lg font-bold lg:block">
          TradeOS
        </Link>

        <div className="min-h-0 flex-1 lg:overflow-y-auto">
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
        </div>

        {/* Pinned to the bottom of the sidebar. `showName` puts the name and
            email inside Clerk's own trigger, so the whole row opens the menu
            rather than only the avatar. */}
        <div className="mt-6 border-t border-slate-200 pt-3 lg:mt-0">
          <UserButton
            showName
            appearance={{
              elements: {
                rootBox: 'w-full',
                userButtonBox:
                  'w-full flex-row-reverse justify-end gap-3 rounded-lg px-2 py-2 ' +
                  'hover:bg-slate-100 transition-colors cursor-pointer',
                userButtonTrigger:
                  'w-full focus:shadow-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded-lg',
                userButtonOuterIdentifier:
                  'text-sm font-medium text-slate-900 truncate max-w-[9rem]',
                avatarBox: 'h-8 w-8',
              },
            }}
          />
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
  const { staleWarning, portfolio, accounts } = useLiveData();
  const { user, refresh } = useRequireAuth();
  const [resent, setResent] = useState(false);

  const stale = accounts.filter(
    (a) => a.status === 'DISCONNECTED' || a.status === 'ERROR',
  );

  return (
    <div className="mb-4 space-y-3 empty:mb-0">
      {staleWarning ? (
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
