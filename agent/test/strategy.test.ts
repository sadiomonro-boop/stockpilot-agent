// Unit tests for the strategy math. Deterministic: fixed fixtures, no
// network, no randomness. Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { clamp, computeTargets, momentum, planRebalance, scoreSymbol, sma } from "../src/strategy.js";
import type { Signal, Target } from "../src/types.js";

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

test("momentum: (last / k-th previous close) - 1", () => {
  assert.ok(approx(momentum([100, 110], 3)!, 0.1));
  assert.ok(approx(momentum([100, 105, 110, 121], 3)!, 0.21));
  assert.ok(approx(momentum([100, 90], 3)!, -0.1));
  assert.equal(momentum([100], 3), null);
  assert.equal(momentum([], 3), null);
  assert.equal(momentum([0, 100], 3), null);
});

test("sma: mean of the last window closes", () => {
  assert.equal(sma([10, 20, 30], 3), 20);
  assert.equal(sma([10, 20, 30, 40], 3), 30);
  assert.equal(sma([10], 3), null);
});

test("clamp", () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

test("scoreSymbol: warming up with a single close", () => {
  const s = scoreSymbol("TSLAc", [387.79], 387.79, "chainlink");
  assert.equal(s.momentum, null);
  assert.equal(s.score, 0);
  assert.match(s.reason, /warming up/);
});

test("scoreSymbol: positive momentum above trend scores up", () => {
  // closes rising: 100 -> 105 -> 110 -> 121; momentum over 3 = +21%
  const s = scoreSymbol("NVDAc", [100, 105, 110, 121], 121, "chainlink");
  assert.ok(Math.abs(s.momentum! - 0.21) < 1e-9);
  assert.equal(s.trendUp, true);
  assert.ok(Math.abs(s.score - 0.21) < 1e-9);
});

test("scoreSymbol: momentum is clipped at +/-0.25", () => {
  const s = scoreSymbol("MSTRc", [100, 100, 100, 200], 200, "api");
  assert.ok(Math.abs(s.momentum! - 1) < 1e-9);
  assert.equal(s.score, 0.25);
});

test("scoreSymbol: below-trend names are never overweighted", () => {
  // momentum positive over the window but last close below the SMA
  const s = scoreSymbol("SNDKc", [100, 120, 130, 110], 110, "chainlink");
  assert.ok(s.momentum! > 0);
  assert.equal(s.trendUp, false);
  assert.ok(s.score <= 0);
});

test("scoreSymbol: negative momentum scores down", () => {
  const s = scoreSymbol("AAPLc", [120, 115, 110, 100], 100, "chainlink");
  assert.ok(s.momentum! < 0);
  assert.ok(s.score < 0);
});

function fakeSignal(symbol: string, score: number): Signal {
  return {
    symbol,
    price: 100,
    source: "chainlink",
    momentum: score,
    sma: 100,
    trendUp: score >= 0,
    score,
    reason: "fixture",
  };
}

test("computeTargets: flat scores give equal weights minus cash reserve", () => {
  // Production universe has 10 names: base = (1 - 0.05) / 10 = 9.5% each.
  const signals = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((s) => fakeSignal(s, 0));
  const targets = computeTargets(signals, {}, 10_000);
  for (const t of targets) {
    assert.ok(approx(t.targetWeight, 0.095), `${t.symbol} ${t.targetWeight}`);
  }
  const sum = targets.reduce((a, t) => a + t.targetWeight, 0);
  assert.ok(approx(sum, 0.95));
});

test("computeTargets: the 20% cap binds when equal weight would exceed it", () => {
  // 4 names only: equal weight would be 23.75% > 20% cap, so all clamp.
  const signals = ["A", "B", "C", "D"].map((s) => fakeSignal(s, 0));
  const targets = computeTargets(signals, {}, 10_000);
  for (const t of targets) {
    assert.ok(approx(t.targetWeight, 0.2), `${t.symbol} ${t.targetWeight}`);
  }
  // The unplaceable 15% stays as cash (sum 0.80 < 0.95 budget).
  const sum = targets.reduce((a, t) => a + t.targetWeight, 0);
  assert.ok(approx(sum, 0.8));
});

test("computeTargets: no position exceeds the 20% cap", () => {
  // One name with a huge positive score, rest flat: the winner is capped.
  const signals = [
    fakeSignal("WIN", 0.25),
    ...["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((s) => fakeSignal(s, 0)),
  ];
  const targets = computeTargets(signals, {}, 10_000);
  for (const t of targets) {
    assert.ok(t.targetWeight <= 0.2 + 1e-9, `${t.symbol} ${t.targetWeight}`);
  }
  const win = targets.find((t) => t.symbol === "WIN")!;
  assert.ok(win.targetWeight > 0.095, "winner is overweighted");
  const sum = targets.reduce((a, t) => a + t.targetWeight, 0);
  assert.ok(sum <= 0.95 + 1e-9);
});

test("computeTargets: deterministic — same input, same output", () => {
  const signals = ["A", "B", "C"].map((s, i) => fakeSignal(s, [0.1, -0.05, 0][i]));
  const a = computeTargets(signals, { A: 1000, B: 500 }, 10_000);
  const b = computeTargets(signals, { A: 1000, B: 500 }, 10_000);
  assert.deepEqual(a, b);
});

function fakeTarget(symbol: string, targetWeight: number, currentWeight: number, value = 10_000): Target {
  return {
    symbol,
    targetWeight,
    currentWeight,
    targetValueUsd: targetWeight * value,
    currentValueUsd: currentWeight * value,
  };
}

test("planRebalance: skips trades below the weight threshold", () => {
  const targets = [fakeTarget("A", 0.1, 0.095), fakeTarget("B", 0.1, 0.1)];
  const { trades } = planRebalance(targets, { A: 100, B: 100 }, 10_000, false);
  assert.equal(trades.length, 0); // 0.5pp gap < 1pp threshold
});

test("planRebalance: buys underweight, sells overweight", () => {
  // $1,000 each way: total $2,000 turnover is under the 25% ($2,500) cap.
  const targets = [fakeTarget("A", 0.15, 0.05), fakeTarget("B", 0.05, 0.15)];
  const { trades } = planRebalance(targets, { A: 100, B: 100 }, 10_000, false);
  assert.equal(trades.length, 2);
  const buy = trades.find((t) => t.symbol === "A")!;
  const sell = trades.find((t) => t.symbol === "B")!;
  assert.equal(buy.side, "BUY");
  assert.ok(approx(buy.valueUsd, 1000, 1e-6));
  assert.equal(sell.side, "SELL");
  assert.ok(approx(sell.valueUsd, 1000, 1e-6));
});

test("planRebalance: turnover cap scales trades down proportionally", () => {
  // Total planned turnover $9,000 on a $10,000 portfolio; cap is 25% = $2,500.
  const targets = [
    fakeTarget("A", 0.4, 0),
    fakeTarget("B", 0.4, 0),
    fakeTarget("C", 0.1, 0),
  ];
  const { trades, notes } = planRebalance(targets, { A: 100, B: 100, C: 100 }, 10_000, false);
  const total = trades.reduce((a, t) => a + t.valueUsd, 0);
  assert.ok(Math.abs(total - 2500) < 1e-6, `total ${total}`);
  assert.ok(notes.some((n) => n.includes("turnover cap")));
});

test("planRebalance: initial allocation is exempt from the turnover cap", () => {
  const targets = [fakeTarget("A", 0.4, 0), fakeTarget("B", 0.4, 0), fakeTarget("C", 0.1, 0)];
  const { trades } = planRebalance(targets, { A: 100, B: 100, C: 100 }, 10_000, true);
  const total = trades.reduce((a, t) => a + t.valueUsd, 0);
  assert.ok(Math.abs(total - 9000) < 1e-6, `total ${total}`);
});

test("planRebalance: skips symbols with no price, notes it", () => {
  const targets = [fakeTarget("A", 0.2, 0), fakeTarget("B", 0.2, 0)];
  const { trades, notes } = planRebalance(targets, { A: 100 }, 10_000, true);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].symbol, "A");
  assert.ok(notes.some((n) => n.includes("B: skipped")));
});

test("planRebalance: dust trades below $25 are skipped", () => {
  const targets = [fakeTarget("A", 0.102, 0.1)]; // $20 gap on $10k
  const { trades } = planRebalance(targets, { A: 100 }, 10_000, true);
  assert.equal(trades.length, 0);
});
