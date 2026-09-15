'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@tradeos/shared';
import { get, post } from '@/lib/api';
import {
  Button,
  Card,
  PageHeader,
  SkeletonTable,
  TableWrap,
  cx,
  inputClass,
  tdClass,
  thClass,
} from '@/components/ui';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
  accountCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ pageSize: '50' });
    if (search.trim()) query.set('search', search.trim());
    try {
      const data = await get<{ items: AdminUser[] }>(`/admin/users?${query}`);
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(user: AdminUser, enabled: boolean) {
    const ok = window.confirm(
      enabled
        ? `Re-enable ${user.email}?`
        : `Disable ${user.email}?\n\nThey are signed out immediately and cannot sign back in. ` +
            'Their agents stop being served commands.',
    );
    if (!ok) return;

    setBusyId(user.id);
    try {
      await post(`/admin/users/${user.id}/status`, { enabled });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="Users" description="Every registered account." />

      <Card className="mb-4">
        <input
          className={cx(inputClass, 'max-w-sm')}
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Card>

      {loading ? (
        <SkeletonTable columns={8} rows={8} />
      ) : (
        <TableWrap>
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={thClass}>User</th>
                <th className={thClass}>Role</th>
                <th className={thClass}>Verified</th>
                <th className={thClass}>Accounts</th>
                <th className={thClass}>Registered</th>
                <th className={thClass}>Last login</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className={tdClass}>
                    <div className="font-medium text-slate-900">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className={tdClass}>{user.role}</td>
                  <td className={tdClass}>{user.emailVerified ? 'Yes' : 'No'}</td>
                  <td className={tdClass}>{user.accountCount}</td>
                  <td className={`${tdClass} text-xs text-slate-500`}>
                    {formatDateTime(user.createdAt)}
                  </td>
                  <td className={`${tdClass} text-xs text-slate-500`}>
                    {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                  </td>
                  <td className={tdClass}>
                    <span
                      className={cx(
                        'rounded px-2 py-0.5 text-xs font-semibold',
                        user.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-100 text-red-800',
                      )}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <Button
                      variant="ghost"
                      disabled={busyId === user.id}
                      onClick={() => void setStatus(user, user.status !== 'ACTIVE')}
                      className={user.status === 'ACTIVE' ? 'text-red-600' : 'text-emerald-700'}
                    >
                      {user.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Trading passwords are never stored by TradeOS, so there is nothing here for an administrator
        to reveal.
      </p>
    </>
  );
}
