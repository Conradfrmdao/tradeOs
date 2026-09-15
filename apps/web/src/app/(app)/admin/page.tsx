'use client';

import { useEffect, useState } from 'react';
import type { CopyEventDto } from '@tradeos/shared';
import { get } from '@/lib/api';
import {
  Card,
  PageHeader,
  SkeletonScreen,
  SkeletonHeader,
  SkeletonCard,
  SkeletonList,
  Stat,
} from '@/components/ui';
import { CopyEventFeed } from '@/components/copy-event-feed';

interface Overview {
  users: { total: number; active: number; disabled: number };
  accounts: { total: number; online: number; offline: number; masters: number; followers: number };
  copier: { activeCopiers: number; failedCopiesLast24h: number; pendingTasks: number };
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<CopyEventDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [data, eventData] = await Promise.all([
          get<Overview>('/admin/overview'),
          get<{ items: CopyEventDto[] }>('/admin/events?pageSize=40'),
        ]);
        setOverview(data);
        setEvents(eventData.items);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <SkeletonScreen label="Loading admin overview">
        <SkeletonHeader />
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard rows={3} />
          <SkeletonCard rows={3} />
          <SkeletonCard rows={3} />
        </div>
        <SkeletonList rows={8} />
      </SkeletonScreen>
    );
  }
  if (!overview) return null;

  return (
    <>
      <PageHeader title="Admin dashboard" description="System-wide health and activity." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Users</h2>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Total">{overview.users.total}</Stat>
            <Stat label="Active">{overview.users.active}</Stat>
            <Stat label="Disabled">{overview.users.disabled}</Stat>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Trading accounts
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Online">{overview.accounts.online}</Stat>
            <Stat label="Offline">{overview.accounts.offline}</Stat>
            <Stat label="Total">{overview.accounts.total}</Stat>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {overview.accounts.masters} master · {overview.accounts.followers} follower
          </p>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Copier</h2>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Active">{overview.copier.activeCopiers}</Stat>
            <Stat label="Queued">{overview.copier.pendingTasks}</Stat>
            <Stat label="Failed 24h">
              <span className={overview.copier.failedCopiesLast24h > 0 ? 'text-loss' : undefined}>
                {overview.copier.failedCopiesLast24h}
              </span>
            </Stat>
          </div>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        System-wide copy events
      </h2>
      <CopyEventFeed events={events} emptyHint="No copy activity across any account yet." />
    </>
  );
}
