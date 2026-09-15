import { describe, expect, it } from 'vitest';
import {
  buildDedupeKey,
  computeMaxDrawdown,
  computeTradeStats,
  resolveCopyVolume,
  resolveDirection,
  resolveSymbol,
  roundToStep,
} from '@tradeos/shared';

/**
 * The risk rules decide how much money moves. They are pure functions, so they
 * get exhaustive tests — including the awkward cases that only show up against
 * a real broker at 3am.
 */

describe('resolveCopyVolume', () => {
  const base = { riskMode: 'SAME_LOT' as const, lotMultiplier: 1, fixedLot: 0.1 };

  it('mirrors the master lot in SAME_LOT mode', () => {
    expect(resolveCopyVolume(1.0, base).volume).toBe(1.0);
    expect(resolveCopyVolume(0.37, base).volume).toBe(0.37);
  });

  it('applies the multiplier (PRD 13 example: 1.00 x 0.50 = 0.50)', () => {
    const rules = { ...base, riskMode: 'LOT_MULTIPLIER' as const, lotMultiplier: 0.5 };
    expect(resolveCopyVolume(1.0, rules).volume).toBe(0.5);
    expect(resolveCopyVolume(2.0, rules).volume).toBe(1.0);
  });

  it('ignores the master lot entirely in FIXED_LOT mode', () => {
    const rules = { ...base, riskMode: 'FIXED_LOT' as const, fixedLot: 0.1 };
    expect(resolveCopyVolume(5.0, rules).volume).toBe(0.1);
    expect(resolveCopyVolume(0.01, rules).volume).toBe(0.1);
  });

  it('does not accumulate floating point error', () => {
    const rules = { ...base, riskMode: 'LOT_MULTIPLIER' as const, lotMultiplier: 0.3 };
    // 0.1 * 3 in binary floating point is 0.30000000000000004.
    const result = resolveCopyVolume(1.0, rules);
    expect(result.volume).toBe(0.3);
    expect(String(result.volume)).toBe('0.3');
  });

  it('clamps to the user maximum before rounding, not after', () => {
    const rules = { ...base, riskMode: 'LOT_MULTIPLIER' as const, lotMultiplier: 10, maxLot: 0.05 };
    const result = resolveCopyVolume(1.0, rules);
    expect(result.volume).toBe(0.05);
    expect(result.code).toBe('CLAMPED_TO_USER_MAX');
  });

  it('raises to the user minimum', () => {
    const rules = { ...base, riskMode: 'LOT_MULTIPLIER' as const, lotMultiplier: 0.01, minLot: 0.1 };
    const result = resolveCopyVolume(1.0, rules);
    expect(result.volume).toBe(0.1);
    expect(result.code).toBe('RAISED_TO_USER_MIN');
  });

  it('nudges up to the broker minimum only when the gap is a rounding artefact', () => {
    const rules = { ...base, riskMode: 'LOT_MULTIPLIER' as const, lotMultiplier: 0.0095 };
    // 0.0095 lots vs a 0.01 minimum — within one step, so it is nudged.
    const near = resolveCopyVolume(1.0, rules, { volumeMin: 0.01, volumeStep: 0.01 });
    expect(near.rejected).toBe(false);
    expect(near.volume).toBe(0.01);
  });

  it('rejects rather than silently inflating a much-too-small volume', () => {
    // 0.001 lots against a 0.1 minimum: rounding up would be 100x the risk the
    // user configured, so the trade is refused and the reason is reported.
    const rules = { ...base, riskMode: 'FIXED_LOT' as const, fixedLot: 0.001 };
    const result = resolveCopyVolume(1.0, rules, { volumeMin: 0.1, volumeStep: 0.01 });
    expect(result.rejected).toBe(true);
    expect(result.code).toBe('BELOW_MIN_TRADABLE');
    expect(result.note).toContain('below the broker minimum');
  });

  it('respects a broker volume step that is not 0.01', () => {
    const rules = { ...base, riskMode: 'LOT_MULTIPLIER' as const, lotMultiplier: 0.37 };
    const result = resolveCopyVolume(1.0, rules, { volumeMin: 0.1, volumeStep: 0.1 });
    expect(result.volume).toBe(0.4);
  });

  it('clamps to the broker maximum', () => {
    const rules = { ...base, riskMode: 'FIXED_LOT' as const, fixedLot: 500 };
    const result = resolveCopyVolume(1.0, rules, { volumeMax: 100, volumeStep: 0.01 });
    expect(result.volume).toBe(100);
    expect(result.code).toBe('CLAMPED_TO_BROKER_MAX');
  });
});

describe('roundToStep', () => {
  it('removes binary floating point residue', () => {
    expect(roundToStep(0.30000000000000004, 0.01)).toBe(0.3);
    expect(roundToStep(0.1 + 0.2, 0.01)).toBe(0.3);
    expect(roundToStep(1.005, 0.01)).toBe(1.01);
    expect(roundToStep(0.0001, 0.001)).toBe(0);
  });
});

describe('resolveDirection', () => {
  it('passes through when reversing is off', () => {
    expect(resolveDirection('BUY', false)).toBe('BUY');
    expect(resolveDirection('SELL', false)).toBe('SELL');
  });

  it('inverts when reversing is on', () => {
    expect(resolveDirection('BUY', true)).toBe('SELL');
    expect(resolveDirection('SELL', true)).toBe('BUY');
  });
});

describe('resolveSymbol', () => {
  const mappings = [
    { masterSymbol: 'XAUUSD', followerSymbol: 'GOLD' },
    { masterSymbol: 'US30', followerSymbol: 'US30.cash' },
    { masterSymbol: 'NAS100', followerSymbol: 'USTEC' },
  ];

  it('maps the PRD 15 examples', () => {
    expect(resolveSymbol('XAUUSD', mappings)).toBe('GOLD');
    expect(resolveSymbol('US30', mappings)).toBe('US30.cash');
    expect(resolveSymbol('NAS100', mappings)).toBe('USTEC');
  });

  it('matches case-insensitively', () => {
    expect(resolveSymbol('xauusd', mappings)).toBe('GOLD');
  });

  it('passes unmapped symbols through unchanged', () => {
    expect(resolveSymbol('EURUSD', mappings)).toBe('EURUSD');
    expect(resolveSymbol('EURUSD', [])).toBe('EURUSD');
  });
});

describe('buildDedupeKey', () => {
  it('is stable across repeated observations of the same event', () => {
    expect(buildDedupeKey('OPEN', 'abc')).toBe(buildDedupeKey('OPEN', 'abc'));
  });

  it('separates open from close for the same position', () => {
    expect(buildDedupeKey('OPEN', 'abc')).not.toBe(buildDedupeKey('CLOSE', 'abc'));
  });

  it('treats a genuinely new stop level as a new event', () => {
    const first = buildDedupeKey('MODIFY', 'abc', { stopLoss: 1.1, takeProfit: 1.2 });
    const same = buildDedupeKey('MODIFY', 'abc', { stopLoss: 1.1, takeProfit: 1.2 });
    const moved = buildDedupeKey('MODIFY', 'abc', { stopLoss: 1.15, takeProfit: 1.2 });

    expect(first).toBe(same);
    expect(first).not.toBe(moved);
  });

  it('treats a missing stop and a zero stop as the same thing', () => {
    // MetaTrader reports "no stop" as 0.0, so these must not be distinct
    // events — otherwise clearing a stop would queue a task on every sync.
    expect(buildDedupeKey('MODIFY', 'abc', { stopLoss: 0, takeProfit: null })).toBe(
      buildDedupeKey('MODIFY', 'abc', { stopLoss: null, takeProfit: 0 }),
    );
  });
});

describe('computeTradeStats', () => {
  const trades = [
    { netProfit: 100, volume: 1, closeTime: '2026-01-01T00:00:00Z' },
    { netProfit: 200, volume: 1, closeTime: '2026-01-02T00:00:00Z' },
    { netProfit: -50, volume: 1, closeTime: '2026-01-03T00:00:00Z' },
    { netProfit: -100, volume: 1, closeTime: '2026-01-04T00:00:00Z' },
  ];

  it('computes the PRD 20 figures', () => {
    const stats = computeTradeStats(trades);
    expect(stats.totalTrades).toBe(4);
    expect(stats.winningTrades).toBe(2);
    expect(stats.losingTrades).toBe(2);
    expect(stats.winRate).toBe(50);
    expect(stats.grossProfit).toBe(300);
    expect(stats.grossLoss).toBe(150);
    expect(stats.netProfit).toBe(150);
    expect(stats.averageWin).toBe(150);
    expect(stats.averageLoss).toBe(75);
    expect(stats.largestWin).toBe(200);
    expect(stats.largestLoss).toBe(100);
    expect(stats.profitFactor).toBe(2);
  });

  it('reports no profit factor rather than Infinity when nothing lost', () => {
    const stats = computeTradeStats([
      { netProfit: 100, volume: 1, closeTime: '2026-01-01T00:00:00Z' },
    ]);
    expect(stats.profitFactor).toBeNull();
  });

  it('handles an empty history without dividing by zero', () => {
    const stats = computeTradeStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.profitFactor).toBeNull();
  });
});

describe('computeMaxDrawdown', () => {
  it('measures peak to trough, not first to last', () => {
    const result = computeMaxDrawdown([1000, 1200, 900, 1100, 800, 1500]);
    // Worst fall is 1200 -> 800.
    expect(result.absolute).toBe(400);
    expect(result.percent).toBeCloseTo(33.33, 1);
  });

  it('reports zero for a series that only rises', () => {
    expect(computeMaxDrawdown([100, 200, 300]).absolute).toBe(0);
  });

  it('handles an empty series', () => {
    expect(computeMaxDrawdown([]).absolute).toBe(0);
  });
});
