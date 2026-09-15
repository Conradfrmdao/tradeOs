/**
 * Pure copy-rule logic: how a master trade becomes a follower instruction.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested exhaustively — this is the part of the system where a bug costs real
 * money, so it deliberately has no I/O, no clock, and no database.
 */

import type { RiskMode, TradeDirection, CopyAction } from './enums';
import { MIN_SENDABLE_LOT } from './constants';

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export interface VolumeRules {
  riskMode: RiskMode;
  lotMultiplier: number;
  fixedLot: number;
  /** Optional hard floor configured by the user. */
  minLot?: number | null;
  /** Optional hard ceiling configured by the user. */
  maxLot?: number | null;
}

/** Volume constraints reported by the follower's broker for a given symbol. */
export interface SymbolVolumeSpec {
  volumeMin?: number | null;
  volumeMax?: number | null;
  volumeStep?: number | null;
}

export type VolumeResolutionCode =
  | 'OK'
  | 'CLAMPED_TO_USER_MAX'
  | 'RAISED_TO_USER_MIN'
  | 'CLAMPED_TO_BROKER_MAX'
  | 'RAISED_TO_BROKER_MIN'
  | 'BELOW_MIN_TRADABLE';

export interface VolumeResolution {
  /** Lot size to send, already rounded to the broker's volume step. */
  volume: number;
  /** Volume before clamping/rounding — useful for the event log. */
  requested: number;
  code: VolumeResolutionCode;
  /** True when the trade must not be sent at all. */
  rejected: boolean;
  note?: string;
}

/**
 * Rounds to a broker volume step without floating-point drift.
 * `roundToStep(0.29999999999999993, 0.01) === 0.3`
 */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  // Work in integer multiples of the step, then undo, then trim the residue
  // that binary floating point leaves behind (e.g. 0.30000000000000004).
  //
  // The quotient is normalised before rounding because a value that is exactly
  // half a step in decimal is often slightly *under* half in binary — 1.005 is
  // stored as 1.00499999999999989, so a naive Math.round would send 1.00 to the
  // broker where a trader reading the number expects 1.01.
  const units = Math.round(Number((value / step).toFixed(9)));
  const decimals = decimalsOf(step);
  return Number((units * step).toFixed(decimals));
}

function decimalsOf(step: number): number {
  const text = String(step);
  if (text.includes('e-')) return Number(text.split('e-')[1]) || 8;
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Applies the follower's risk mode (PRD 13) then every guard, in this order:
 *   risk mode -> user min/max -> broker min/max -> broker step -> sanity floor
 *
 * The order matters: rounding last means a user max of 0.05 with a broker step
 * of 0.01 yields 0.05, not 0.06.
 */
export function resolveCopyVolume(
  masterVolume: number,
  rules: VolumeRules,
  spec: SymbolVolumeSpec = {},
): VolumeResolution {
  let requested: number;

  switch (rules.riskMode) {
    case 'FIXED_LOT':
      requested = rules.fixedLot;
      break;
    case 'LOT_MULTIPLIER':
      requested = masterVolume * rules.lotMultiplier;
      break;
    case 'SAME_LOT':
    default:
      requested = masterVolume;
      break;
  }

  let volume = requested;
  let code: VolumeResolutionCode = 'OK';

  if (rules.maxLot != null && volume > rules.maxLot) {
    volume = rules.maxLot;
    code = 'CLAMPED_TO_USER_MAX';
  }
  if (rules.minLot != null && volume < rules.minLot) {
    volume = rules.minLot;
    code = 'RAISED_TO_USER_MIN';
  }

  if (spec.volumeMax != null && volume > spec.volumeMax) {
    volume = spec.volumeMax;
    code = 'CLAMPED_TO_BROKER_MAX';
  }

  const brokerMin = spec.volumeMin ?? null;
  if (brokerMin != null && volume < brokerMin) {
    // Rounding up to the broker minimum would trade more risk than the user
    // asked for, so raise only when the shortfall is a rounding artefact
    // (within one step); otherwise reject and say why.
    const step = spec.volumeStep ?? 0.01;
    if (brokerMin - volume <= step) {
      volume = brokerMin;
      code = 'RAISED_TO_BROKER_MIN';
    } else {
      return {
        volume: 0,
        requested,
        code: 'BELOW_MIN_TRADABLE',
        rejected: true,
        note: `Computed ${formatLot(volume)} lots is below the broker minimum of ${formatLot(brokerMin)}`,
      };
    }
  }

  volume = roundToStep(volume, spec.volumeStep ?? 0.01);

  if (volume < (brokerMin ?? MIN_SENDABLE_LOT)) {
    return {
      volume: 0,
      requested,
      code: 'BELOW_MIN_TRADABLE',
      rejected: true,
      note: `Computed ${formatLot(requested)} lots rounds to zero at this broker's volume step`,
    };
  }

  return { volume, requested, code, rejected: false };
}

export function formatLot(value: number): string {
  return value.toFixed(2);
}

// ---------------------------------------------------------------------------
// Direction and symbol
// ---------------------------------------------------------------------------

export function resolveDirection(
  masterDirection: TradeDirection,
  reverse: boolean,
): TradeDirection {
  if (!reverse) return masterDirection;
  return masterDirection === 'BUY' ? 'SELL' : 'BUY';
}

/**
 * Maps a master symbol onto the follower's broker naming (PRD 15).
 * Lookup is case-insensitive; an unmapped symbol passes through unchanged.
 */
export function resolveSymbol(
  masterSymbol: string,
  mappings: Array<{ masterSymbol: string; followerSymbol: string }>,
): string {
  const needle = masterSymbol.trim().toUpperCase();
  for (const m of mappings) {
    if (m.masterSymbol.trim().toUpperCase() === needle) return m.followerSymbol;
  }
  return masterSymbol;
}

// ---------------------------------------------------------------------------
// Idempotency (PRD 42)
// ---------------------------------------------------------------------------

/**
 * Derives the deduplication key for a copy task.
 *
 * The key is a pure function of the *master event*, never of the time it was
 * observed — that is what makes re-observing an event (agent reconnect, server
 * restart, retried request) a no-op instead of a duplicate trade.
 *
 * MODIFY includes the target stops, so a genuinely new SL/TP produces a new
 * task while a repeated report of the same SL/TP does not.
 */
export function buildDedupeKey(
  action: CopyAction,
  masterPositionId: string,
  extra?: { stopLoss?: number | null; takeProfit?: number | null; volume?: number | null },
): string {
  switch (action) {
    case 'OPEN':
      return `open:${masterPositionId}`;
    case 'CLOSE':
      return `close:${masterPositionId}`;
    case 'MODIFY':
      return `modify:${masterPositionId}:${norm(extra?.stopLoss)}:${norm(extra?.takeProfit)}`;
    case 'PARTIAL_CLOSE':
      return `partial:${masterPositionId}:${norm(extra?.volume)}`;
    default:
      return `${String(action).toLowerCase()}:${masterPositionId}`;
  }
}

function norm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '0';
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}
