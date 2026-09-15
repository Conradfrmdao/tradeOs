'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatAge, formatMoney } from '@tradeos/shared';
import { useLiveData } from '@/lib/live-data';
import { del } from '@/lib/api';
import {
  Button,
  EmptyState,
  Money,
  PageHeader,
  Spinner,
  StatusBadge,
  TableWrap,
  tdClass,
  thClass,
} from '@/components/ui';

export default function AccountsPage() {
  const { accounts, portfolio, loading, reload } = useLiveData();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (loading) return <Spinner label="Loading accounts" />;

  const atLimit = (portfolio?.totalAccounts ?? 0) >= (portfolio?.maxAccounts ?? 11);

  async function remove(id: string, name: string) {
    // Removing an account stops copying and hides it; the confirm spells that
    // out because the button sits next to routine actions.
    const ok = window.confirm(
      `Remove "${name}"?\n\n` +
        'Copying to or from this account stops immediately. Its closed-trade history is kept ' +
        'for your statistics. Open positions on the broker are NOT closed.',
    );
    if (!ok) return;

    setBusyId(id);
    try {
      await del(`/accounts/${id}`);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description={`${portfolio?.totalAccounts ?? 0} of ${portfolio?.maxAccounts ?? 11} connected.`}
        actions={
          <Link href="/accounts/new">
            <Button disabled={atLimit}>Add account</Button>
          </Link>
        }
      />

      {atLimit ? (
        <p className="mb-4 text-sm text-amber-700">
          You have reached your account limit. Remove an account to connect another.
        </p>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts connected"
          description="Connect a master account first, then add followers to copy its trades."
          action={
            <Link href="/accounts/new?role=MASTER">
              <Button>Connect master account</Button>
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={thClass}>Account</th>
                <th className={thClass}>Role</th>
                <th className={thClass}>Balance</th>
                <th className={thClass}>Equity</th>
                <th className={thClass}>Today</th>
                <th className={thClass}>Total P/L</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Last heartbeat</th>
                <th className={thClass}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <tr key={account.id} className="hover:bg-slate-50">
                  <td className={tdClass}>
                    <Link href={`/accounts/${account.id}`} className="font-medium text-slate-900 underline">
                      {account.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {account.platform} · {account.broker ?? '—'} · {account.accountNumber}
                    </div>
                  </td>
                  <td className={tdClass}>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                      {account.role}
                    </span>
                  </td>
                  <td className={tdClass}>{formatMoney(account.balance, account.currency)}</td>
                  <td className={tdClass}>{formatMoney(account.equity, account.currency)}</td>
                  <td className={tdClass}>
                    <Money value={account.todayPl} currency={account.currency} signed />
                  </td>
                  <td className={tdClass}>
                    <Money value={account.totalPl} currency={account.currency} signed />
                  </td>
                  <td className={tdClass}>
                    <StatusBadge status={account.status} />
                  </td>
                  <td className={tdClass}>
                    <span className="text-xs text-slate-500">
                      {formatAge(account.heartbeatAgeSeconds)}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <div className="flex justify-end gap-2">
                      <Link href={`/accounts/${account.id}`}>
                        <Button variant="secondary">View</Button>
                      </Link>
                      <Button
                        variant="ghost"
                        disabled={busyId === account.id}
                        onClick={() => void remove(account.id, account.name)}
                        className="text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
