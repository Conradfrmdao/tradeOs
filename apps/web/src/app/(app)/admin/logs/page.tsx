'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@tradeos/shared';
import { get } from '@/lib/api';
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  TableWrap,
  cx,
  inputClass,
  tdClass,
  thClass,
} from '@/components/ui';

interface AuditRow {
  id: string;
  actorType: 'USER' | 'ADMIN' | 'AGENT' | 'SYSTEM';
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  user: { email: string; name: string } | null;
  meta: unknown;
  createdAt: string;
}

interface FailureRow {
  id: string;
  followerAccountName: string;
  action: string;
  status: string;
  attempts: number;
  symbol: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export default function AdminLogsPage() {
  const [tab, setTab] = useState<'audit' | 'failures'>('audit');
  const [action, setAction] = useState('');
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [byCode, setByCode] = useState<Array<{ code: string; count: number }>>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'audit') {
        const query = new URLSearchParams({ page: String(page), pageSize: '50' });
        if (action.trim()) query.set('action', action.trim());
        const data = await get<{ items: AuditRow[]; totalPages: number }>(`/admin/logs?${query}`);
        setLogs(data.items);
        setTotalPages(data.totalPages);
      } else {
        const data = await get<{
          tasks: FailureRow[];
          byCode: Array<{ code: string; count: number }>;
        }>('/admin/copy-failures');
        setFailures(data.tasks);
        setByCode(data.byCode);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, action, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title="System logs" description="Audit trail and copier failures." />

      <div className="mb-4 flex gap-2">
        {(['audit', 'failures'] as const).map((option) => (
          <button
            key={option}
            onClick={() => {
              setTab(option);
              setPage(1);
            }}
            className={cx(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              tab === option ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100',
            )}
          >
            {option === 'audit' ? 'Audit trail' : 'Copy failures'}
          </button>
        ))}
      </div>

      {tab === 'audit' ? (
        <>
          <Card className="mb-4">
            <input
              className={cx(inputClass, 'max-w-sm')}
              placeholder="Filter by action, e.g. user.login"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            />
          </Card>

          {loading ? (
            <Spinner />
          ) : logs.length === 0 ? (
            <EmptyState title="No log entries match" />
          ) : (
            <>
              <TableWrap>
                <table className="w-full">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className={thClass}>When</th>
                      <th className={thClass}>Actor</th>
                      <th className={thClass}>Action</th>
                      <th className={thClass}>Entity</th>
                      <th className={thClass}>IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className={`${tdClass} text-xs text-slate-500`}>
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className={tdClass}>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold">
                            {log.actorType}
                          </span>
                          {log.user ? (
                            <span className="ml-2 text-xs text-slate-600">{log.user.email}</span>
                          ) : null}
                        </td>
                        <td className={`${tdClass} font-mono text-xs`}>{log.action}</td>
                        <td className={`${tdClass} text-xs text-slate-500`}>
                          {log.entityType ?? '—'}
                        </td>
                        <td className={`${tdClass} font-mono text-xs text-slate-500`}>
                          {log.ip ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              {totalPages > 1 ? (
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-slate-600">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          {byCode.length > 0 ? (
            <Card className="mb-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Failures by reason
              </h2>
              <div className="flex flex-wrap gap-2">
                {byCode.map((row) => (
                  <span
                    key={row.code}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-800"
                  >
                    {row.code} <span className="font-semibold">{row.count}</span>
                  </span>
                ))}
              </div>
            </Card>
          ) : null}

          {failures.length === 0 ? (
            <EmptyState
              title="No copy failures"
              description="Every copy operation has succeeded so far."
            />
          ) : (
            <TableWrap>
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className={thClass}>When</th>
                    <th className={thClass}>Follower</th>
                    <th className={thClass}>Action</th>
                    <th className={thClass}>Symbol</th>
                    <th className={thClass}>Attempts</th>
                    <th className={thClass}>Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {failures.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-50">
                      <td className={`${tdClass} text-xs text-slate-500`}>
                        {formatDateTime(task.createdAt)}
                      </td>
                      <td className={tdClass}>{task.followerAccountName}</td>
                      <td className={tdClass}>{task.action}</td>
                      <td className={tdClass}>{task.symbol ?? '—'}</td>
                      <td className={tdClass}>{task.attempts}</td>
                      <td className={tdClass}>
                        <span className="font-medium text-red-700">{task.errorCode ?? 'UNKNOWN'}</span>
                        {task.errorMessage ? (
                          <div className="max-w-md truncate text-xs text-slate-500" title={task.errorMessage}>
                            {task.errorMessage}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      )}
    </>
  );
}
