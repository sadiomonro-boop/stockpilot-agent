// Paper-trading portfolio engine. Virtual USDC only, fills at NAV, no
// fees, no slippage, no leverage, no shorting. Pure functions over an
// explicit Portfolio object so every fill is reproducible in tests.

import type { ExecutedTrade, PlannedTrade, Position } from "./types.js";

export interface Portfolio {
  cashUsd: number;
  positions: Record<string, Position>;
  startCapitalUsd: number;
}

export function emptyPortfolio(startCapitalUsd: number): Portfolio {
  return { cashUsd: startCapitalUsd, positions: {}, startCapitalUsd };
}

export function positionValue(
  portfolio: Portfolio,
  prices: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [symbol, pos] of Object.entries(portfolio.positions)) {
    const price = prices[symbol];
    out[symbol] = price !== undefined && price > 0 ? pos.tokens * price : 0;
  }
  return out;
}

export function portfolioValue(
  portfolio: Portfolio,
  prices: Record<string, number>,
): number {
  const values = positionValue(portfolio, prices);
  return portfolio.cashUsd + Object.values(values).reduce((a, b) => a + b, 0);
}

/** Fill one planned trade at the NAV price. Buys are capped by available
 *  cash, sells by the tokens held. Returns the executed trade (possibly
 *  partial) or null if nothing could be filled. */
export function applyTrade(
  portfolio: Portfolio,
  trade: PlannedTrade,
  at: string,
  cycle: number,
): ExecutedTrade | null {
  const pos = portfolio.positions[trade.symbol] ?? { tokens: 0, avgPrice: 0 };

  if (trade.side === "BUY") {
    const affordableTokens = portfolio.cashUsd / trade.price;
    const tokens = Math.min(trade.tokens, affordableTokens);
    if (tokens <= 0) return null;
    const cost = tokens * trade.price;
    const newAvg =
      pos.tokens + tokens > 0
        ? (pos.tokens * pos.avgPrice + cost) / (pos.tokens + tokens)
        : trade.price;
    portfolio.positions[trade.symbol] = { tokens: pos.tokens + tokens, avgPrice: newAvg };
    portfolio.cashUsd -= cost;
    return {
      ...trade,
      tokens,
      valueUsd: cost,
      at,
      cycle,
      journalTx: null,
      journalStatus: "skipped",
      reason:
        tokens < trade.tokens
          ? `${trade.reason}; partial fill ${tokens.toFixed(6)} of ${trade.tokens.toFixed(6)} tokens (cash limit)`
          : trade.reason,
    };
  }

  // SELL
  const tokens = Math.min(trade.tokens, pos.tokens);
  if (tokens <= 0) return null;
  const proceeds = tokens * trade.price;
  const remaining = pos.tokens - tokens;
  if (remaining <= 1e-12) {
    delete portfolio.positions[trade.symbol];
  } else {
    portfolio.positions[trade.symbol] = { tokens: remaining, avgPrice: pos.avgPrice };
  }
  portfolio.cashUsd += proceeds;
  return {
    ...trade,
    tokens,
    valueUsd: proceeds,
    at,
    cycle,
    journalTx: null,
    journalStatus: "skipped",
    reason:
      tokens < trade.tokens
        ? `${trade.reason}; partial fill ${tokens.toFixed(6)} of ${trade.tokens.toFixed(6)} tokens (holding limit)`
        : trade.reason,
  };
}
