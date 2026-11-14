// Unit tests for the paper-trading portfolio engine. Fixed fixtures,
// no network. Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { applyTrade, emptyPortfolio, portfolioValue } from "../src/portfolio.js";
import type { PlannedTrade } from "../src/types.js";

function buy(symbol: string, tokens: number, price: number): PlannedTrade {
  return { symbol, side: "BUY", tokens, price, valueUsd: tokens * price, reason: "fixture buy" };
}
function sell(symbol: string, tokens: number, price: number): PlannedTrade {
  return { symbol, side: "SELL", tokens, price, valueUsd: tokens * price, reason: "fixture sell" };
}

test("buy fills at NAV and updates cash + average price", () => {
  const p = emptyPortfolio(10_000);
  const ex = applyTrade(p, buy("TSLAc", 10, 387.79), "2026-11-15T00:00:00Z", 1)!;
  assert.ok(ex !== null);
  assert.ok(Math.abs(ex.valueUsd - 3877.9) < 1e-6);
  assert.ok(Math.abs(p.cashUsd - (10_000 - 3877.9)) < 1e-6);
  assert.ok(Math.abs(p.positions["TSLAc"].tokens - 10) < 1e-9);
  assert.ok(Math.abs(p.positions["TSLAc"].avgPrice - 387.79) < 1e-9);
});

test("second buy averages the price", () => {
  const p = emptyPortfolio(10_000);
  applyTrade(p, buy("TSLAc", 10, 100), "t", 1);
  applyTrade(p, buy("TSLAc", 10, 200), "t", 1);
  assert.ok(Math.abs(p.positions["TSLAc"].avgPrice - 150) < 1e-9);
  assert.ok(Math.abs(p.positions["TSLAc"].tokens - 20) < 1e-9);
});

test("buy is capped by available cash (partial fill)", () => {
  const p = emptyPortfolio(100);
  const ex = applyTrade(p, buy("NVDAc", 10, 160.77), "t", 1)!;
  assert.ok(ex.valueUsd <= 100 + 1e-9);
  assert.ok(Math.abs(p.cashUsd) < 1e-9);
  assert.match(ex.reason, /partial fill/);
});

test("sell takes proceeds and removes an emptied position", () => {
  const p = emptyPortfolio(10_000);
  applyTrade(p, buy("AAPLc", 5, 300), "t", 1);
  const ex = applyTrade(p, sell("AAPLc", 5, 355.59), "t", 1)!;
  assert.ok(Math.abs(ex.valueUsd - 5 * 355.59) < 1e-6);
  assert.equal(p.positions["AAPLc"], undefined);
  assert.ok(Math.abs(p.cashUsd - (10_000 - 1500 + 5 * 355.59)) < 1e-6);
});

test("sell is capped by the holding (partial fill)", () => {
  const p = emptyPortfolio(10_000);
  applyTrade(p, buy("MSFTc", 2, 500), "t", 1);
  const ex = applyTrade(p, sell("MSFTc", 10, 522.41), "t", 1)!;
  assert.ok(Math.abs(ex.tokens - 2) < 1e-9);
  assert.match(ex.reason, /partial fill/);
});

test("selling what you do not hold fills nothing", () => {
  const p = emptyPortfolio(10_000);
  const ex = applyTrade(p, sell("METAc", 1, 600), "t", 1);
  assert.equal(ex, null);
});

test("portfolioValue: cash + marked positions", () => {
  const p = emptyPortfolio(10_000);
  applyTrade(p, buy("TSLAc", 10, 100), "t", 1);
  assert.ok(Math.abs(portfolioValue(p, { TSLAc: 120 }) - (9000 + 1200)) < 1e-6);
  // A symbol with no price contributes 0, not NaN.
  assert.ok(Math.abs(portfolioValue(p, {}) - 9000) < 1e-6);
});
