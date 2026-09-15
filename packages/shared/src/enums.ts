/**
 * Enum values mirrored from the Prisma schema.
 *
 * The web app must not depend on @prisma/client (it would drag the query
 * engine into the browser bundle), so the canonical string unions live here
 * and both sides import them. `packages/shared/src/__tests__/enums.test.ts`
 * guards the mirror against drift by parsing schema.prisma.
 */

export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PLATFORMS = ['MT4', 'MT5'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const ACCOUNT_ROLES = ['MASTER', 'FOLLOWER'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_STATUSES = [
  'PENDING',
  'CONNECTING',
  'CONNECTED',
  'DISCONNECTED',
  'ERROR',
  'DISABLED',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const CONNECTOR_TYPES = ['AGENT_EA', 'BROKER_API'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const RISK_MODES = ['SAME_LOT', 'LOT_MULTIPLIER', 'FIXED_LOT'] as const;
export type RiskMode = (typeof RISK_MODES)[number];

export const TRADE_DIRECTIONS = ['BUY', 'SELL'] as const;
export type TradeDirection = (typeof TRADE_DIRECTIONS)[number];

export const POSITION_STATUSES = ['OPEN', 'CLOSED'] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

export const COPY_ACTIONS = ['OPEN', 'CLOSE', 'MODIFY', 'PARTIAL_CLOSE'] as const;
export type CopyAction = (typeof COPY_ACTIONS)[number];

export const COPY_TASK_STATUSES = [
  'PENDING',
  'DISPATCHED',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
  'EXPIRED',
] as const;
export type CopyTaskStatus = (typeof COPY_TASK_STATUSES)[number];

export const COPY_EVENT_TYPES = [
  'MASTER_OPEN',
  'MASTER_CLOSE',
  'MASTER_MODIFY',
  'COPY_QUEUED',
  'COPY_DISPATCHED',
  'COPY_EXECUTED',
  'COPY_FAILED',
  'COPY_SKIPPED',
  'COPY_EXPIRED',
  'ACCOUNT_CONNECTED',
  'ACCOUNT_DISCONNECTED',
  'COPIER_TOGGLED',
  'EMERGENCY_STOP',
] as const;
export type CopyEventType = (typeof COPY_EVENT_TYPES)[number];

export const COPY_EVENT_STATUSES = [
  'INFO',
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
] as const;
export type CopyEventStatus = (typeof COPY_EVENT_STATUSES)[number];

export const NOTIFICATION_SEVERITIES = ['INFO', 'SUCCESS', 'WARNING', 'ERROR'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/**
 * Failure reasons a copy task can carry (PRD 17). The agent reports the raw
 * broker retcode; `mapBrokerError` in the API narrows it to one of these so
 * the UI can show something a human understands.
 */
export const COPY_ERROR_CODES = [
  'SYMBOL_UNAVAILABLE',
  'CONNECTION_LOST',
  'INSUFFICIENT_MARGIN',
  'INVALID_VOLUME',
  'INVALID_STOPS',
  'MARKET_CLOSED',
  'BROKER_REJECTED',
  'REQUOTE',
  'TRADE_DISABLED',
  'POSITION_NOT_FOUND',
  'TASK_EXPIRED',
  'AGENT_OFFLINE',
  'UNKNOWN',
] as const;
export type CopyErrorCode = (typeof COPY_ERROR_CODES)[number];

export const COPY_ERROR_LABELS: Record<CopyErrorCode, string> = {
  SYMBOL_UNAVAILABLE: 'Symbol unavailable on this broker',
  CONNECTION_LOST: 'Connection lost',
  INSUFFICIENT_MARGIN: 'Insufficient margin',
  INVALID_VOLUME: 'Invalid volume',
  INVALID_STOPS: 'Invalid stop loss / take profit',
  MARKET_CLOSED: 'Market closed',
  BROKER_REJECTED: 'Rejected by broker',
  REQUOTE: 'Requote — price moved',
  TRADE_DISABLED: 'Trading disabled on this account',
  POSITION_NOT_FOUND: 'Position not found',
  TASK_EXPIRED: 'Expired before it could be executed',
  AGENT_OFFLINE: 'Terminal agent offline',
  UNKNOWN: 'Unknown error',
};
