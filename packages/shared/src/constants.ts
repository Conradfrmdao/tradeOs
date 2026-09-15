/** Wire-protocol version spoken between the MT4/MT5 agent and the API. */
export const AGENT_PROTOCOL_VERSION = 1;

/** Prefix written into the order comment of every copied trade. */
export const COPY_COMMENT_PREFIX = 'tos';

/** Default MT magic number stamped on copied orders. */
export const COPY_MAGIC_NUMBER = 770145;

/** Lot volumes below this are not worth sending to a broker. */
export const MIN_SENDABLE_LOT = 0.01;

export const SESSION_COOKIE_NAME = 'tos_session';
export const CSRF_COOKIE_NAME = 'tos_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export const SESSION_TTL_DAYS = 7;
export const EMAIL_VERIFY_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_MINUTES = 60;
export const PAIRING_CODE_TTL_MINUTES = 30;

/** Equity curve windows offered in the UI (PRD 21). */
export const CHART_RANGES = ['today', '7d', '30d', '3m', 'all'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export const CHART_RANGE_LABELS: Record<ChartRange, string> = {
  today: 'Today',
  '7d': '7 Days',
  '30d': '30 Days',
  '3m': '3 Months',
  all: 'All Time',
};
