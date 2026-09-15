/**
 * Timezone-aware day boundaries.
 *
 * "Today's profit" has to mean the user's today. Computing it in UTC would
 * silently shift the daily figure for anyone not on UTC — so every daily or
 * range query resolves its boundaries through here, against the timezone on
 * the user's settings.
 */

import type { ChartRange } from '@tradeos/shared';

/** UTC instant of the most recent local midnight in `timeZone`. */
export function startOfLocalDay(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');

  // Seconds elapsed in the local day, subtracted from the current instant.
  // This sidesteps DST arithmetic: we never construct a local wall-clock date,
  // we only ever move backwards from a known instant.
  const elapsed =
    get('hour') * 3600 + get('minute') * 60 + get('second');

  const midnight = new Date(now.getTime() - elapsed * 1000);
  midnight.setUTCMilliseconds(0);
  return midnight;
}

export function startOfLocalWeek(timeZone: string, now = new Date()): Date {
  const dayStart = startOfLocalDay(timeZone, now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const daysSinceMonday = index === 0 ? 6 : index - 1;
  return new Date(dayStart.getTime() - daysSinceMonday * 86_400_000);
}

export function startOfLocalMonth(timeZone: string, now = new Date()): Date {
  const dayStart = startOfLocalDay(timeZone, now);
  const dayOfMonth = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric' }).format(now),
  );
  return new Date(dayStart.getTime() - (dayOfMonth - 1) * 86_400_000);
}

/** Resolves a chart range selector (PRD 21) into a start instant. */
export function rangeStart(range: ChartRange, timeZone: string, now = new Date()): Date | null {
  switch (range) {
    case 'today':
      return startOfLocalDay(timeZone, now);
    case '7d':
      return new Date(now.getTime() - 7 * 86_400_000);
    case '30d':
      return new Date(now.getTime() - 30 * 86_400_000);
    case '3m':
      return new Date(now.getTime() - 90 * 86_400_000);
    case 'all':
    default:
      return null;
  }
}

export function secondsSince(date: Date | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
