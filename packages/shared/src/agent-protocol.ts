/**
 * The contract between a MetaTrader terminal agent (the Expert Advisor) and
 * the TradeOS API.
 *
 * Shape notes, because the other end of this wire is written in MQL:
 *  - every timestamp is an ISO-8601 UTC string
 *  - every price/volume is a JSON number, never a locale-formatted string
 *  - unknown fields are ignored, so the EA and the API can be deployed
 *    independently as long as `protocolVersion` matches
 *
 * The agent drives the whole exchange by polling `/agent/v1/sync`: it pushes
 * its state and the results of previously issued commands, and receives the
 * next batch of commands. One endpoint, one direction of initiation — which
 * means the EA never needs an inbound connection, and reconnects are trivial.
 */

import { z } from 'zod';
import { AGENT_PROTOCOL_VERSION } from './constants';

const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());
const money = z.number().finite();
const price = z.number().finite().nonnegative();
const lot = z.number().finite().positive();

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export const agentPairRequestSchema = z.object({
  pairingCode: z.string().min(6).max(32),
  platform: z.enum(['MT4', 'MT5']),
  accountNumber: z.string().min(1).max(32),
  server: z.string().max(128).optional(),
  broker: z.string().max(128).optional(),
  currency: z.string().max(8).optional(),
  leverage: z.number().int().positive().max(10000).optional(),
  agentVersion: z.string().max(32).optional(),
  terminalBuild: z.string().max(32).optional(),
});
export type AgentPairRequest = z.infer<typeof agentPairRequestSchema>;

export interface AgentPairResponse {
  token: string;
  accountId: string;
  accountName: string;
  role: 'MASTER' | 'FOLLOWER';
  protocolVersion: number;
  pollIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Sync — request
// ---------------------------------------------------------------------------

export const agentAccountStateSchema = z.object({
  balance: money,
  equity: money,
  margin: money.default(0),
  freeMargin: money.default(0),
  marginLevel: money.default(0),
  credit: money.default(0),
  currency: z.string().max(8).optional(),
  leverage: z.number().int().nonnegative().optional(),
  /** AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) — false means the terminal
   *  cannot trade at all, which we surface rather than failing copies later. */
  tradeAllowed: z.boolean().default(true),
  serverTime: isoDate.optional(),
});
export type AgentAccountState = z.infer<typeof agentAccountStateSchema>;

export const agentOpenPositionSchema = z.object({
  ticket: z.string().min(1).max(32),
  positionId: z.string().max(32).optional(),
  magic: z.string().max(32).optional(),
  symbol: z.string().min(1).max(64),
  direction: z.enum(['BUY', 'SELL']),
  volume: lot,
  openPrice: price,
  currentPrice: price.optional(),
  stopLoss: price.optional(),
  takeProfit: price.optional(),
  profit: money.default(0),
  swap: money.default(0),
  commission: money.default(0),
  openTime: isoDate,
  comment: z.string().max(128).optional(),
});
export type AgentOpenPosition = z.infer<typeof agentOpenPositionSchema>;

export const agentClosedPositionSchema = agentOpenPositionSchema
  .omit({ currentPrice: true })
  .extend({
    closePrice: price,
    closeTime: isoDate,
  });
export type AgentClosedPosition = z.infer<typeof agentClosedPositionSchema>;

export const agentCommandResultSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']),
  /** Broker ticket created or affected by the command. */
  ticket: z.string().max(32).optional(),
  /** Raw MT retcode / GetLastError value, kept for support tickets. */
  retcode: z.number().int().optional(),
  errorCode: z.string().max(64).optional(),
  message: z.string().max(512).optional(),
  executedPrice: price.optional(),
  executedVolume: z.number().finite().nonnegative().optional(),
});
export type AgentCommandResult = z.infer<typeof agentCommandResultSchema>;

export const agentSymbolSpecSchema = z.object({
  symbol: z.string().min(1).max(64),
  volumeMin: z.number().finite().positive().optional(),
  volumeMax: z.number().finite().positive().optional(),
  volumeStep: z.number().finite().positive().optional(),
  digits: z.number().int().min(0).max(10).optional(),
  point: z.number().finite().positive().optional(),
  contractSize: z.number().finite().positive().optional(),
  /** False when the symbol exists but is not currently tradable. */
  tradable: z.boolean().optional(),
});
export type AgentSymbolSpec = z.infer<typeof agentSymbolSpecSchema>;

export const agentSyncRequestSchema = z.object({
  protocolVersion: z.number().int().default(AGENT_PROTOCOL_VERSION),
  agentVersion: z.string().max(32).optional(),
  terminalBuild: z.string().max(32).optional(),
  account: agentAccountStateSchema,
  /** Full snapshot of currently open positions — not a delta. The server
   *  diffs it, so a missed poll can never lose an event. */
  positions: z.array(agentOpenPositionSchema).max(500).default([]),
  /** Positions closed since `historyFrom` in the previous response. */
  closed: z.array(agentClosedPositionSchema).max(500).default([]),
  /** Outcomes of commands handed out in previous responses. */
  results: z.array(agentCommandResultSchema).max(100).default([]),
  symbolSpecs: z.array(agentSymbolSpecSchema).max(100).default([]),
});
export type AgentSyncRequest = z.infer<typeof agentSyncRequestSchema>;

// ---------------------------------------------------------------------------
// Sync — response
// ---------------------------------------------------------------------------

export interface AgentCommand {
  id: string;
  action: 'OPEN' | 'CLOSE' | 'MODIFY' | 'PARTIAL_CLOSE';
  symbol: string;
  direction?: 'BUY' | 'SELL';
  volume?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  slippagePoints?: number;
  magic?: number;
  comment?: string;
  /** For CLOSE/MODIFY: the follower's own ticket to act on. */
  targetTicket?: string;
  /** Command is abandoned rather than executed after this instant. */
  expiresAt: string;
}

export interface AgentSyncResponse {
  protocolVersion: number;
  serverTime: string;
  pollIntervalMs: number;
  accountId: string;
  role: 'MASTER' | 'FOLLOWER';
  /** Effective switch: global kill switch AND this follower's own toggle. */
  copyingEnabled: boolean;
  /** Pull closed deals from this instant onward on the next sync. */
  historyFrom: string;
  /** Symbols this follower should report volume specs for. */
  watchSymbols: string[];
  commands: AgentCommand[];
  /** Task ids whose results were recorded — the EA can forget them. */
  acknowledged: string[];
}

export const AGENT_PROTOCOL = { version: AGENT_PROTOCOL_VERSION } as const;
