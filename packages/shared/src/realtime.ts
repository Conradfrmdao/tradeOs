/**
 * Messages pushed over the dashboard WebSocket (PRD 33).
 *
 * The server only ever pushes *changed* state, and every message is
 * self-describing, so a client that reconnects mid-stream can apply whatever
 * arrives next without needing a replay log — it refetches the REST snapshot
 * on connect and then lives on deltas.
 */

import type { AccountDto, CopyEventDto, NotificationDto, PortfolioDto, PositionDto } from './dto';

export type RealtimeMessage =
  | { type: 'hello'; serverTime: string; userId: string }
  | { type: 'pong'; serverTime: string }
  | { type: 'portfolio'; data: PortfolioDto }
  | { type: 'accounts'; data: AccountDto[] }
  | { type: 'account'; data: AccountDto }
  | { type: 'positions.open'; accountId: string; data: PositionDto[] }
  | { type: 'position.closed'; data: PositionDto }
  | { type: 'copy.event'; data: CopyEventDto }
  | { type: 'notification'; data: NotificationDto }
  | { type: 'copying.toggled'; enabled: boolean; scope: 'global' | 'follower'; accountId?: string };

export type RealtimeClientMessage = { type: 'ping' } | { type: 'subscribe'; topics: string[] };

export const REALTIME_PATH = '/ws';
