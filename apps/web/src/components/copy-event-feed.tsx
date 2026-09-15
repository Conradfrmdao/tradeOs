'use client';

import type { CopyEventDto, CopyEventStatus } from '@tradeos/shared';
import { formatTime } from '@tradeos/shared';
import { Card, EmptyState, cx } from './ui';

/**
 * The copy activity log (PRD 16 / 43).
 *
 * Every line answers "what happened, to which account, and did it work" —
 * when a copy fails, this is the first place the user looks, so the reason is
 * shown inline rather than hidden behind a click.
 */

const STATUS_DOT: Record<CopyEventStatus, string> = {
  SUCCESS: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  SKIPPED: 'bg-amber-500',
  PENDING: 'bg-sky-500',
  PROCESSING: 'bg-sky-500 animate-pulse',
  INFO: 'bg-slate-400',
};

export function CopyEventFeed({
  events,
  emptyHint,
}: {
  events: CopyEventDto[];
  emptyHint?: string;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No copy activity yet"
        description={emptyHint ?? 'Events appear here as soon as your master account opens a trade.'}
      />
    );
  }

  return (
    <Card className="p-0">
      <ol className="divide-y divide-slate-100">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3 px-4 py-3">
            <span
              className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', STATUS_DOT[event.status])}
              aria-hidden
            />

            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">{event.message}</p>

              {event.errorLabel ? (
                <p className="mt-0.5 text-xs font-medium text-red-600">
                  Reason: {event.errorLabel}
                </p>
              ) : null}

              <p className="mt-0.5 text-xs text-slate-400">
                <time dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
                {event.followerAccountName ? ` · ${event.followerAccountName}` : ''}
              </p>
            </div>

            <span className="sr-only">{event.status}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
