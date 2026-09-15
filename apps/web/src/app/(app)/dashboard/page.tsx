'use client';

import Link from 'next/link';
import type { AccountDto } from '@tradeos/shared';
import { formatAge, formatMoney } from '@tradeos/shared';
import { useLiveData } from '@/lib/live-data';
import {
  Button,
  Card,
  EmptyState,
  Money,
  PageHeader,
  SkeletonScreen,
  SkeletonHeader,
  SkeletonStatRow,
  SkeletonCard,
  SkeletonList,
  SkeletonChart,
  Stat,
  StatusBadge,
  cx,
} from '@/components/ui';
import { EquityChart } from '@/components/equity-chart';
import { CopyEventFeed } from '@/components/copy-event-feed';

export default function DashboardPage() {
  const { portfolio, accounts, events, loading } = useLiveData();

  if (loading) {
    return (
      <SkeletonScreen label="Loading your portfolio">
        <SkeletonHeader />
        <SkeletonStatRow />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <SkeletonCard />
            <div className="grid gap-4 sm:grid-cols-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
            <SkeletonChart />
          </div>
          <SkeletonList rows={8} />
        </div>
      </SkeletonScreen>
    );
  }

  const master = accounts.find((a) => a.role === 'MASTER');
  const followers = accounts.filter((a) => a.role === 'FOLLOWER');

  if (accounts.length === 0) return <FirstRun />;

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Every connected account, live."
        actions={
          <Link href="/accounts">
            <Button variant="secondary">Manage accounts</Button>
          </Link>
        }
      />

      {/* Portfolio summary (PRD 8) */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Total balance">{formatMoney(portfolio?.totalBalance ?? 0)}</Stat>
          <Stat label="Total equity">{formatMoney(portfolio?.totalEquity ?? 0)}</Stat>
          <Stat label="Today's profit">
            <Money value={portfolio?.todayPl ?? 0} signed />
          </Stat>
          <Stat label="Total profit">
            <Money value={portfolio?.totalPl ?? 0} signed />
          </Stat>
          <Stat label="Open positions">{portfolio?.openPositions ?? 0}</Stat>
          <Stat
            label="Connected"
            hint={`limit ${portfolio?.maxAccounts ?? 11}`}
          >
            {portfolio?.connectedAccounts ?? 0} / {portfolio?.totalAccounts ?? 0}
          </Stat>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {master ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Master
              </h2>
              <AccountCard account={master} />
            </section>
          ) : (
            <EmptyState
              title="No master account yet"
              description="Trades are copied from a master account. Connect one to get started."
              action={
                <Link href="/accounts/new?role=MASTER">
                  <Button>Connect master account</Button>
                </Link>
              }
            />
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Followers ({followers.length})
              </h2>
              <Link href="/accounts/new?role=FOLLOWER" className="text-sm text-slate-600 underline">
                Add follower
              </Link>
            </div>

            {followers.length === 0 ? (
              <EmptyState
                title="No followers connected"
                description="Add a follower account to start copying the master's trades."
                action={
                  <Link href="/accounts/new?role=FOLLOWER">
                    <Button>Add follower</Button>
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {followers.map((account) => (
                  <AccountCard key={account.id} account={account} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Equity performance
            </h2>
            <Card>
              <EquityChart />
            </Card>
          </section>
        </div>

        <div className="lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Copy activity
          </h2>
          <CopyEventFeed events={events.slice(0, 25)} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function AccountCard({ account }: { account: AccountDto }) {
  return (
    <Link href={`/accounts/${account.id}`} className="block">
      <Card className="h-full transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {account.role}
            </div>
            <div className="truncate font-semibold text-slate-900">{account.name}</div>
            <div className="truncate text-xs text-slate-500">
              {account.platform} · {account.broker ?? 'Unknown broker'} · {account.accountNumber}
            </div>
          </div>

          {account.role === 'FOLLOWER' ? (
            <span
              className={cx(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                account.copying ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600',
              )}
            >
              {account.copying ? 'COPY ON' : 'COPY OFF'}
            </span>
          ) : null}
        </div>

        {/* Two columns, not four: a follower card is half the width of the
            master card, and four money figures across it run into each other. */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
          <Stat label="Balance" size="sm">
            {formatMoney(account.balance, account.currency, { compact: true })}
          </Stat>
          <Stat label="Equity" size="sm">
            {formatMoney(account.equity, account.currency, { compact: true })}
          </Stat>
          <Stat label="Today" size="sm">
            <Money value={account.todayPl} currency={account.currency} signed />
          </Stat>
          <Stat label="Total P/L" size="sm">
            <Money value={account.totalPl} currency={account.currency} signed />
          </Stat>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
          <StatusBadge status={account.status} />
          {/* PRD 24: the user must be able to see at a glance how fresh this is. */}
          <span className="text-xs text-slate-500">
            {account.openPositions} open · {formatAge(account.heartbeatAgeSeconds)}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function FirstRun() {
  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Welcome to TradeOS</h1>
      <p className="mx-auto mt-2 max-w-lg text-slate-600">
        Connect your first master trading account. TradeOS watches it for trades and copies them to
        the followers you add next.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/accounts/new?role=MASTER&platform=MT4">
          <Button variant="secondary">Connect MT4</Button>
        </Link>
        <Link href="/accounts/new?role=MASTER&platform=MT5">
          <Button>Connect MT5</Button>
        </Link>
      </div>

      <p className="mt-8 text-sm text-slate-500">
        Your trading password is never requested or stored. TradeOS connects through a small agent
        you run inside your own MetaTrader terminal.
      </p>
    </div>
  );
}
