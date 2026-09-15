'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AccountStatus, Platform } from '@tradeos/shared';
import { formatAge, formatMoney } from '@tradeos/shared';
import { get, post } from '@/lib/api';
import {
  Button,
  Card,
  PageHeader,
  Spinner,
  StatusBadge,
  TableWrap,
  cx,
  inputClass,
  tdClass,
  thClass,
} from '@/components/ui';

interface AdminAccount {
  id: string;
  name: string;
  platform: Platform;
  broker: string | null;
  accountNumber: string;
  server: string | null;
  role: 'MASTER' | 'FOLLOWER';
  status: AccountStatus;
  enabled: boolean;
  balance: number | null;
  equity: number | null;
  currency: string;
  heartbeatAgeSeconds: number | null;
  lastError: string | null;
  agentVersion: string | null;
  owner: { id: string; email: string; name: string };
}

const STATUSES = ['all', 'CONNECTED', 'DISCONNECTED', 'PENDING', 'ERROR', 'DISABLED'];

export default function AdminAccountsPage() {
  const [status, setStatus] = useState('all');
  const [items, setItems] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<{ items: AdminAccount[] }>(
        `/admin/accounts?status=${status}&pageSize=100`,
      );
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setEnabled(account: AdminAccount, enabled: boolean) {
    const ok = window.confirm(
      enabled
        ? `Re-enable "${account.name}"?`
        : `Disable "${account.name}"?\n\nIts agent stops receiving commands and no trades will be ` +
            'copied to or from it. Open positions are not touched.',
    );
    if (!ok) return;

    setBusyId(account.id);
    try {
      await post(`/admin/accounts/${account.id}/status`, { enabled });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Trading accounts"
        description="Every connected account across all users."
      />

      <Card className="mb-4">
        <select
          className={cx(inputClass, 'max-w-xs')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          {STATUSES.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'All statuses' : option}
            </option>
          ))}
        </select>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <TableWrap>
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={thClass}>Account</th>
                <th className={thClass}>Owner</th>
                <th className={thClass}>Role</th>
                <th className={thClass}>Balance</th>
                <th className={thClass}>Equity</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Heartbeat</th>
                <th className={thClass}>Agent</th>
                <th className={thClass}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((account) => (
                <tr key={account.id} className="hover:bg-slate-50">
                  <td className={tdClass}>
                    <div className="font-medium text-slate-900">{account.name}</div>
                    <div className="text-xs text-slate-500">
                      {account.platform} &middot; {account.accountNumber} &middot;{' '}
                      {account.broker ?? 'Unknown broker'}
                    </div>
                    {account.lastError ? (
                      <div
                        className="mt-0.5 max-w-xs truncate text-xs text-red-600"
                        title={account.lastError}
                      >
                        {account.lastError}
                      </div>
                    ) : null}
                  </td>
                  <td className={`${tdClass} text-xs`}>{account.owner.email}</td>
                  <td className={tdClass}>{account.role}</td>
                  <td className={tdClass}>{formatMoney(account.balance, account.currency)}</td>
                  <td className={tdClass}>{formatMoney(account.equity, account.currency)}</td>
                  <td className={tdClass}>
                    <StatusBadge status={account.status} />
                  </td>
                  <td className={`${tdClass} text-xs text-slate-500`}>
                    {formatAge(account.heartbeatAgeSeconds)}
                  </td>
                  <td className={`${tdClass} text-xs text-slate-500`}>
                    {account.agentVersion ?? 'Unknown'}
                  </td>
                  <td className={tdClass}>
                    <Button
                      variant="ghost"
                      disabled={busyId === account.id}
                      onClick={() => void setEnabled(account, !account.enabled)}
                      className={account.enabled ? 'text-red-600' : 'text-emerald-700'}
                    >
                      {account.enabled ? 'Disable' : 'Enable'}
                    </Button>
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
