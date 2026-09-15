/**
 * Response shapes returned by the API and consumed by the web app.
 *
 * All monetary values cross the wire as plain JSON numbers (the API converts
 * from Prisma Decimal at the edge) — the UI only ever displays them, and never
 * does arithmetic that Decimal would have protected.
 */

import type {
  AccountRole,
  AccountStatus,
  CopyEventStatus,
  CopyEventType,
  CopyTaskStatus,
  NotificationSeverity,
  Platform,
  PositionStatus,
  RiskMode,
  TradeDirection,
  UserRole,
} from './enums';
import type { TradeStats } from './stats';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  createdAt: string;
  settings: UserSettingsDto;
}

export interface UserSettingsDto {
  copyingEnabled: boolean;
  emergencyStopAt: string | null;
  notifyEmail: boolean;
  notifyOnCopyOk: boolean;
  notifyOnCopyFail: boolean;
  notifyOnConnect: boolean;
  notifyOnDisconnect: boolean;
  timezone: string;
}

export interface AccountDto {
  id: string;
  name: string;
  platform: Platform;
  broker: string | null;
  accountNumber: string;
  server: string | null;
  currency: string;
  leverage: number | null;
  role: AccountRole;
  status: AccountStatus;
  enabled: boolean;

  balance: number | null;
  equity: number | null;
  margin: number | null;
  freeMargin: number | null;
  marginLevel: number | null;
  floatingPl: number | null;

  /** Realised P/L since local midnight in the user's timezone. */
  todayPl: number;
  /** Realised P/L across all recorded closed trades. */
  totalPl: number;
  openPositions: number;

  lastHeartbeatAt: string | null;
  /** Seconds since the agent last checked in; null when it never has. */
  heartbeatAgeSeconds: number | null;
  lastError: string | null;
  agentVersion: string | null;

  /** Present on followers only. */
  copying: boolean | null;
  paired: boolean;
  createdAt: string;
}

export interface PortfolioDto {
  totalBalance: number;
  totalEquity: number;
  todayPl: number;
  totalPl: number;
  floatingPl: number;
  openPositions: number;
  connectedAccounts: number;
  totalAccounts: number;
  maxAccounts: number;
  copyingEnabled: boolean;
  emergencyStopAt: string | null;
}

export interface PositionDto {
  id: string;
  accountId: string;
  accountName: string;
  accountRole: AccountRole;
  ticket: string;
  symbol: string;
  direction: TradeDirection;
  volume: number;
  openPrice: number;
  currentPrice: number | null;
  closePrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number;
  swap: number;
  commission: number;
  netProfit: number;
  openTime: string;
  closeTime: string | null;
  status: PositionStatus;
  comment: string | null;
  /** Set on follower positions that mirror a master trade. */
  masterPositionId: string | null;
}

export interface CopierSettingsDto {
  id: string;
  masterAccountId: string;
  followerAccountId: string;
  followerName: string;
  enabled: boolean;
  riskMode: RiskMode;
  lotMultiplier: number;
  fixedLot: number;
  minLot: number | null;
  maxLot: number | null;
  copyStopLoss: boolean;
  copyTakeProfit: boolean;
  copyPendingOrders: boolean;
  reverseTrades: boolean;
  maxSlippagePoints: number;
  symbolMappings: Array<{ id: string; masterSymbol: string; followerSymbol: string }>;
}

export interface CopyEventDto {
  id: string;
  eventType: CopyEventType;
  status: CopyEventStatus;
  message: string;
  errorCode: string | null;
  errorLabel: string | null;
  masterAccountId: string | null;
  masterAccountName: string | null;
  followerAccountId: string | null;
  followerAccountName: string | null;
  copyTaskId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface CopyTaskDto {
  id: string;
  followerAccountId: string;
  followerAccountName: string;
  action: string;
  status: CopyTaskStatus;
  attempts: number;
  maxAttempts: number;
  symbol: string | null;
  volume: number | null;
  followerTicket: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AccountStatsDto extends TradeStats {
  accountId: string;
  accountName: string;
  maxDrawdown: number;
  maxDrawdownPercent: number;
}

export interface EquityPointDto {
  at: string;
  equity: number;
  balance: number;
}

export interface NotificationDto {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface PairingDto {
  accountId: string;
  pairingCode: string;
  expiresAt: string;
  apiUrl: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level messages keyed by form path, for inline form errors. */
    fields?: Record<string, string>;
  };
}
