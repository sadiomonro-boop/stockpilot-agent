// Strategy: deterministic, rules-based, fully explainable.
// No ML, no randomness, no hidden state. Every number below is a pure
// function of the inputs, so any decision can be replayed from the stored
// price history.
//
// Signals (per symbol, from the stored NAV closes):
//   momentum = (last close / close `lookback` cycles ago) - 1, null if the
//     history is too short (the agent says so instead of inventing one).
//   sma      = mean of the last `trendWindow` closes, null if too short.
//   trendUp  = last close > sma.
//   score    = momentum clipped to +/- momentumClip; forced to <= 0 when
//     the price is below its SMA (never overweight a downtrend).
//
// Targets: equal base weight (minus a cash reserve), tilted by the score:
//   raw = base * (1 + tiltStrength * score), clamped to [0, maxPosition],
//   then normalised to the invested budget. Clamp + normalise repeats a few
//   times; any leftover that cannot be placed stays as cash.
//
// Rebalance plan: trade only when the weight gap exceeds the threshold and
// the trade is at least minTradeUsd; total turnover per cycle is capped
// (except the initial allocation, cycle 1 on an empty portfolio).

import { STRATEGY } from "./config.js";
import type { PlannedTrade, Quote, Signal, Target } from "./types.js";

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Momentum over the last `lookback` steps of `closes` (oldest -> newest).
 *  Returns null when fewer than 2 closes exist. */
export function momentum(closes: number[], lookback: number): number | null {
  if (closes.length < 2) return null;
  const start = closes[Math.max(0, closes.length - 1 - lookback)];
  const last = closes[closes.length - 1];
  if (!(start > 0) || !(last > 0)) return null;
  return last / start - 1;
}

/** Simple moving average of the last `window` closes, null if < 2 closes. */
export function sma(closes: number[], window: number): number | null {
  if (closes.length < 2) return null;
  const slice = closes.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Score one symbol from its close history. Pure and deterministic. */
export function scoreSymbol(
  symbol: string,
  closes: number[],
  price: number,
  source: Quote["source"],
): Signal {
  const mom = momentum(closes, STRATEGY.momentumLookback);
  const avg = sma(closes, STRATEGY.trendWindow);
  // At the average counts as "at trend", not below it.
  const trendUp = avg === null ? null : price >= avg;
  let score = mom === null ? 0 : clamp(mom, -STRATEGY.momentumClip, STRATEGY.momentumClip);
  if (trendUp === false) score = Math.min(score, 0);
  const parts: string[] = [];
  if (mom === null) {
    parts.push("warming up: only 1 close in history, no momentum yet");
  } else {
    parts.push(`momentum ${(mom * 100).toFixed(2)}% over ${STRATEGY.momentumLookback} cycles`);
  }
  if (avg !== null) {
    parts.push(trendUp ? "at or above trend (SMA)" : "below trend (SMA), no overweight");
  }
  parts.push(`score ${score.toFixed(4)}`);
  parts.push(`price from ${source}`);
  return {
    symbol,
    price,
    source,
    momentum: mom,
    sma: avg,
    trendUp,
    score,
    reason: parts.join("; "),
  };
}

/** Target weights for the whole universe from the signals. */
export function computeTargets(
  signals: Signal[],
  currentValues: Record<string, number>,
  portfolioValue: number,
): Target[] {
  const n = signals.length;
  const investedBudget = 1 - STRATEGY.cashReservePct;
  const base = n > 0 ? investedBudget / n : 0;

  let raws = signals.map((s) =>
    clamp(base * (1 + STRATEGY.tiltStrength * s.score), 0, STRATEGY.maxPositionPct),
  );
  // Normalise to the invested budget, re-clamping a few times so no
  // position can be pushed back over the cap by normalisation.
  for (let i = 0; i < 3; i++) {
    const sum = raws.reduce((a, b) => a + b, 0);
    if (sum <= 0) break;
    raws = raws.map((w) => clamp((w / sum) * investedBudget, 0, STRATEGY.maxPositionPct));
  }
  // Whatever is left unplaced (because of the cap) stays as cash.
  return signals.map((s, i) => {
    const currentValue = currentValues[s.symbol] ?? 0;
    return {
      symbol: s.symbol,
      targetWeight: raws[i],
      currentWeight: portfolioValue > 0 ? currentValue / portfolioValue : 0,
      targetValueUsd: raws[i] * portfolioValue,
      currentValueUsd: currentValue,
    };
  });
}

/** Turn targets into a concrete trade list, with reasons and caps. */
export function planRebalance(
  targets: Target[],
  prices: Record<string, number>,
  portfolioValue: number,
  isInitialAllocation: boolean,
): { trades: PlannedTrade[]; notes: string[] } {
  const notes: string[] = [];
  const raw: PlannedTrade[] = [];

  for (const t of targets) {
    const price = prices[t.symbol];
    if (!(price > 0)) {
      notes.push(`${t.symbol}: skipped, no price this cycle`);
      continue;
    }
    const deltaUsd = t.targetValueUsd - t.currentValueUsd;
    const weightGap = Math.abs(t.targetWeight - t.currentWeight);
    if (!isInitialAllocation && weightGap < STRATEGY.rebalanceThresholdPct) {
      continue;
    }
    if (Math.abs(deltaUsd) < STRATEGY.minTradeUsd) continue;
    const side = deltaUsd > 0 ? "BUY" : "SELL";
    raw.push({
      symbol: t.symbol,
      side,
      tokens: Math.abs(deltaUsd) / price,
      price,
      valueUsd: Math.abs(deltaUsd),
      reason:
        `${side} ${t.symbol}: target ${(t.targetWeight * 100).toFixed(2)}% ` +
        `vs current ${(t.currentWeight * 100).toFixed(2)}% of portfolio ` +
        `($${t.targetValueUsd.toFixed(2)} vs $${t.currentValueUsd.toFixed(2)})`,
    });
  }

  // Turnover cap (rebalancing only — the initial allocation is exempt).
  const totalTurnover = raw.reduce((a, t) => a + t.valueUsd, 0);
  const cap = STRATEGY.maxTurnoverPct * portfolioValue;
  if (!isInitialAllocation && totalTurnover > cap && totalTurnover > 0) {
    const scale = cap / totalTurnover;
    notes.push(
      `turnover cap: planned $${totalTurnover.toFixed(2)} exceeds ` +
        `$${cap.toFixed(2)} (${(STRATEGY.maxTurnoverPct * 100).toFixed(0)}% of portfolio); ` +
        `all trades scaled x${scale.toFixed(3)}`,
    );
    // Deterministic order before scaling (largest first, symbol as tiebreak).
    raw.sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol));
    for (const t of raw) {
      t.valueUsd *= scale;
      t.tokens *= scale;
      t.reason += `; scaled x${scale.toFixed(3)} by turnover cap`;
    }
  }

  return { trades: raw, notes };
}
