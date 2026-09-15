import type {
  CopierSettings,
  CopyEvent,
  CopyTask,
  Notification,
  Position,
  SymbolMapping,
  TradingAccount,
  User,
  UserSettings,
} from '@tradeos/db';
import {
  COPY_ERROR_LABELS,
  type CopierSettingsDto,
  type CopyEventDto,
  type CopyErrorCode,
  type CopyTaskDto,
  type NotificationDto,
  type PositionDto,
  type UserDto,
  type UserSettingsDto,
} from '@tradeos/shared';
import { toNum, toNumber } from './num';

/**
 * Prisma row -> API DTO.
 *
 * Centralised so that a column added to the schema never leaks to the client
 * by accident — most importantly `encryptedCredentials` and `passwordHash`,
 * which no serializer here ever reads.
 */

export function serializeUser(user: User & { settings: UserSettings | null }): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    settings: serializeUserSettings(user.settings),
  };
}

export function serializeUserSettings(settings: UserSettings | null): UserSettingsDto {
  return {
    copyingEnabled: settings?.copyingEnabled ?? true,
    emergencyStopAt: settings?.emergencyStopAt?.toISOString() ?? null,
    notifyEmail: settings?.notifyEmail ?? true,
    notifyOnCopyOk: settings?.notifyOnCopyOk ?? false,
    notifyOnCopyFail: settings?.notifyOnCopyFail ?? true,
    notifyOnConnect: settings?.notifyOnConnect ?? true,
    notifyOnDisconnect: settings?.notifyOnDisconnect ?? true,
    timezone: settings?.timezone ?? 'UTC',
  };
}

export function serializePosition(
  position: Position,
  account: Pick<TradingAccount, 'id' | 'name' | 'role'>,
): PositionDto {
  return {
    id: position.id,
    accountId: account.id,
    accountName: account.name,
    accountRole: account.role,
    ticket: position.ticket,
    symbol: position.symbol,
    direction: position.direction,
    volume: toNum(position.volume),
    openPrice: toNum(position.openPrice),
    currentPrice: toNumber(position.currentPrice),
    closePrice: toNumber(position.closePrice),
    stopLoss: toNumber(position.stopLoss),
    takeProfit: toNumber(position.takeProfit),
    profit: toNum(position.profit),
    swap: toNum(position.swap),
    commission: toNum(position.commission),
    netProfit: toNum(position.netProfit),
    openTime: position.openTime.toISOString(),
    closeTime: position.closeTime?.toISOString() ?? null,
    status: position.status,
    comment: position.comment,
    masterPositionId: position.masterPositionId,
  };
}

export function serializeCopierSettings(
  settings: CopierSettings & {
    symbolMappings: SymbolMapping[];
    followerAccount?: Pick<TradingAccount, 'name'> | null;
  },
): CopierSettingsDto {
  return {
    id: settings.id,
    masterAccountId: settings.masterAccountId,
    followerAccountId: settings.followerAccountId,
    followerName: settings.followerAccount?.name ?? '',
    enabled: settings.enabled,
    riskMode: settings.riskMode,
    lotMultiplier: toNum(settings.lotMultiplier, 1),
    fixedLot: toNum(settings.fixedLot, 0.1),
    minLot: toNumber(settings.minLot),
    maxLot: toNumber(settings.maxLot),
    copyStopLoss: settings.copyStopLoss,
    copyTakeProfit: settings.copyTakeProfit,
    copyPendingOrders: settings.copyPendingOrders,
    reverseTrades: settings.reverseTrades,
    maxSlippagePoints: settings.maxSlippagePoints,
    symbolMappings: settings.symbolMappings.map((m) => ({
      id: m.id,
      masterSymbol: m.masterSymbol,
      followerSymbol: m.followerSymbol,
    })),
  };
}

export function serializeCopyEvent(
  event: CopyEvent & {
    masterAccount?: Pick<TradingAccount, 'name'> | null;
    followerAccount?: Pick<TradingAccount, 'name'> | null;
  },
): CopyEventDto {
  return {
    id: event.id,
    eventType: event.eventType,
    status: event.status,
    message: event.message,
    errorCode: event.errorCode,
    errorLabel: errorLabel(event.errorCode),
    masterAccountId: event.masterAccountId,
    masterAccountName: event.masterAccount?.name ?? null,
    followerAccountId: event.followerAccountId,
    followerAccountName: event.followerAccount?.name ?? null,
    copyTaskId: event.copyTaskId,
    meta: (event.meta as Record<string, unknown> | null) ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

export function serializeCopyTask(
  task: CopyTask & { followerAccount?: Pick<TradingAccount, 'name'> | null },
): CopyTaskDto {
  const payload = (task.payload ?? {}) as { symbol?: string; volume?: number };
  return {
    id: task.id,
    followerAccountId: task.followerAccountId,
    followerAccountName: task.followerAccount?.name ?? '',
    action: task.action,
    status: task.status,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    symbol: payload.symbol ?? null,
    volume: payload.volume ?? null,
    followerTicket: task.followerTicket,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

export function serializeNotification(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    severity: notification.severity,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function errorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return COPY_ERROR_LABELS[code as CopyErrorCode] ?? code;
}
