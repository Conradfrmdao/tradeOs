/**
 * Trading statistics (PRD 20 / 22). Pure functions over plain numbers so the
 * same code produces per-account and portfolio-wide figures, and so the maths
 * can be unit tested without a database.
 */

export interface ClosedTradeLike {
  netProfit: number;
  volume: number;
  closeTime: Date | string;
}

export interface TradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number; // 0..100
  grossProfit: number;
  grossLoss: number; // positive magnitude
  netProfit: number;
  averageWin: number;
  averageLoss: number; // positive magnitude
  largestWin: number;
  largestLoss: number; // positive magnitude
  averageTrade: number;
  /** null when there were no losses at all — "infinite" is not a number. */
  profitFactor: number | null;
  totalVolume: number;
}

export const EMPTY_STATS: TradeStats = {
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  breakEvenTrades: 0,
  winRate: 0,
  grossProfit: 0,
  grossLoss: 0,
  netProfit: 0,
  averageWin: 0,
  averageLoss: 0,
  largestWin: 0,
  largestLoss: 0,
  averageTrade: 0,
  profitFactor: null,
  totalVolume: 0,
};

export function computeTradeStats(trades: ClosedTradeLike[]): TradeStats {
  if (trades.length === 0) return { ...EMPTY_STATS };

  let grossProfit = 0;
  let grossLoss = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakEvenTrades = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalVolume = 0;

  for (const t of trades) {
    const p = t.netProfit;
    totalVolume += t.volume;

    if (p > 0) {
      winningTrades++;
      grossProfit += p;
      if (p > largestWin) largestWin = p;
    } else if (p < 0) {
      losingTrades++;
      grossLoss += -p;
      if (-p > largestLoss) largestLoss = -p;
    } else {
      breakEvenTrades++;
    }
  }

  const totalTrades = trades.length;
  const netProfit = grossProfit - grossLoss;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    // Break-even trades count in the denominator: a user comparing accounts
    // wants "wins out of trades taken", not a figure that quietly drops them.
    winRate: round2((winningTrades / totalTrades) * 100),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    netProfit: round2(netProfit),
    averageWin: winningTrades ? round2(grossProfit / winningTrades) : 0,
    averageLoss: losingTrades ? round2(grossLoss / losingTrades) : 0,
    largestWin: round2(largestWin),
    largestLoss: round2(largestLoss),
    averageTrade: round2(netProfit / totalTrades),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    totalVolume: round2(totalVolume),
  };
}

/** Merges per-account stats into one portfolio figure without re-reading trades. */
export function mergeTradeStats(all: TradeStats[]): TradeStats {
  const present = all.filter((s) => s.totalTrades > 0);
  if (present.length === 0) return { ...EMPTY_STATS };

  const totalTrades = sum(present, (s) => s.totalTrades);
  const winningTrades = sum(present, (s) => s.winningTrades);
  const losingTrades = sum(present, (s) => s.losingTrades);
  const breakEvenTrades = sum(present, (s) => s.breakEvenTrades);
  const grossProfit = sum(present, (s) => s.grossProfit);
  const grossLoss = sum(present, (s) => s.grossLoss);
  const netProfit = grossProfit - grossLoss;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    winRate: round2((winningTrades / totalTrades) * 100),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    netProfit: round2(netProfit),
    averageWin: winningTrades ? round2(grossProfit / winningTrades) : 0,
    averageLoss: losingTrades ? round2(grossLoss / losingTrades) : 0,
    largestWin: Math.max(...present.map((s) => s.largestWin)),
    largestLoss: Math.max(...present.map((s) => s.largestLoss)),
    averageTrade: round2(netProfit / totalTrades),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    totalVolume: round2(sum(present, (s) => s.totalVolume)),
  };
}

export interface DrawdownResult {
  /** Largest peak-to-trough fall, as a positive amount. */
  absolute: number;
  /** The same fall as a percentage of the peak it fell from. */
  percent: number;
  peak: number;
  trough: number;
}

/**
 * Maximum drawdown over an equity series, in chronological order.
 *
 * Measured peak-to-trough on running equity — not on a sorted list of losses —
 * so it reflects the worst run the account actually lived through.
 */
export function computeMaxDrawdown(equitySeries: number[]): DrawdownResult {
  if (equitySeries.length === 0) {
    return { absolute: 0, percent: 0, peak: 0, trough: 0 };
  }

  let peak = equitySeries[0]!;
  let maxAbsolute = 0;
  let maxPercent = 0;
  let atPeak = peak;
  let atTrough = peak;

  for (const value of equitySeries) {
    if (value > peak) peak = value;
    const fall = peak - value;
    if (fall > maxAbsolute) {
      maxAbsolute = fall;
      atPeak = peak;
      atTrough = value;
    }
    // Track the worst *percentage* fall separately: a 500 drop from 100k is a
    // bigger number but a smaller setback than a 400 drop from 1k.
    const pct = peak > 0 ? (fall / peak) * 100 : 0;
    if (pct > maxPercent) maxPercent = pct;
  }

  return {
    absolute: round2(maxAbsolute),
    percent: round2(maxPercent),
    peak: round2(atPeak),
    trough: round2(atTrough),
  };
}

/**
 * Builds a cumulative-profit curve from closed trades, for accounts that have
 * no equity snapshot history yet (e.g. freshly imported history).
 */
export function cumulativeProfitSeries(
  trades: ClosedTradeLike[],
  startingBalance = 0,
): number[] {
  const ordered = [...trades].sort(
    (a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime(),
  );
  const series: number[] = [startingBalance];
  let running = startingBalance;
  for (const t of ordered) {
    running += t.netProfit;
    series.push(round2(running));
  }
  return series;
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
