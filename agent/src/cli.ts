// StockPilot CLI.
//   npm run agent:once   — one full cycle: fetch -> decide -> paper-trade
//                          -> record to the Sepolia journal -> print report.
//   npm run agent:report — print the current portfolio, PnL and decisions.
// Paper trades only. No real money, no mainnet trading, no investment advice.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { SEPOLIA_EXPLORER, UNIVERSE } from "./config.js";
import {
  buildQuotes,
  fetchChainlinkNavs,
  fetchTokenList,
} from "./data.js";
import { computeTargets, planRebalance, scoreSymbol } from "./strategy.js";
import {
  applyTrade,
  emptyPortfolio,
  portfolioValue,
  positionValue,
} from "./portfolio.js";
import { dashboardSnapshot, loadState, saveState } from "./state.js";
import { getPendingNonce, readDeployment, recordTradeOnChain } from "./journal.js";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentState, Decision, ExecutedTrade, Quote } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url)); // agent/dist/src
const AGENT_DIR = join(HERE, "..", "..");
const ROOT = join(AGENT_DIR, "..");
const STATE_PATH = join(AGENT_DIR, "state.json");
const TOKEN_LIST_PATH = join(AGENT_DIR, "token-list.json");
const DEPLOYMENT_PATH = join(ROOT, "contracts", "deployment-sepolia.json");
const DASHBOARD_STATE_PATH = join(ROOT, "dashboard", "state.json");

function fmtUsd(x: number): string {
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

async function runOnce(): Promise<void> {
  const state: AgentState = loadState(STATE_PATH);
  const cycle = state.cyclesRun + 1;
  const at = new Date().toISOString();
  const notes: string[] = [];

  // Journal config (Base Sepolia testnet). Resolved once, reused for the
  // backfill below and for this cycle's trades.
  const deployment = readDeployment(DEPLOYMENT_PATH);
  const journalKey = process.env.TRADE_JOURNAL_KEY as `0x${string}` | undefined;

  // Serialised journal writer: one nonce counter for the whole run, so
  // rapid successive writes cannot collide on a stale pending nonce.
  // Retries once with a freshly fetched nonce if the node rejects it.
  let nextNonce: number | null = null;
  async function journalWrite(trade: ExecutedTrade): Promise<string> {
    if (!deployment || !journalKey) throw new Error("journal not configured");
    if (nextNonce === null) {
      nextNonce = await getPendingNonce(privateKeyToAccount(journalKey).address);
    }
    try {
      const tx = await recordTradeOnChain(deployment.address, journalKey, trade, { nonce: nextNonce });
      nextNonce += 1;
      return tx;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("nonce")) {
        nextNonce = await getPendingNonce(privateKeyToAccount(journalKey).address);
        const tx = await recordTradeOnChain(deployment.address, journalKey, trade, { nonce: nextNonce });
        nextNonce += 1;
        return tx;
      }
      throw err;
    }
  }

  // Backfill: retry any earlier trade whose journal write failed, so the
  // on-chain record eventually mirrors every paper trade.
  if (deployment && journalKey) {
    const failed = state.trades.filter((t) => t.journalStatus === "failed");
    for (const t of failed) {
      try {
        const tx = await journalWrite(t);
        t.journalTx = tx;
        t.journalStatus = "recorded";
        console.log(`  journal backfill: ${t.symbol} ${t.side} (cycle ${t.cycle}) -> ${tx}`);
      } catch (err) {
        notes.push(
          `backfill failed for ${t.symbol} (cycle ${t.cycle}): ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
      }
    }
    // Keep the decision records consistent with the backfilled trades.
    for (const d of state.decisions) {
      for (const dt of d.trades) {
        const updated = state.trades.find(
          (t) => t.cycle === dt.cycle && t.symbol === dt.symbol && t.side === dt.side,
        );
        if (updated) {
          dt.journalTx = updated.journalTx;
          dt.journalStatus = updated.journalStatus;
        }
      }
    }
  }

  console.log(`\n=== StockPilot cycle ${cycle} — ${at} ===\n`);

  // 1. Data: token list + Chainlink NAVs (multi-RPC, API fallback).
  const { tokens, source, pages } = await fetchTokenList(TOKEN_LIST_PATH);
  console.log(`Token list: ${tokens.length} tokens (${source}${pages ? `, ${pages} pages` : ""})`);
  const chainlink = await fetchChainlinkNavs();
  const clOk = Object.values(chainlink.perFeed).filter((f) => f.ok).length;
  console.log(
    `Chainlink NAVs: ${clOk}/${UNIVERSE.length} feeds ok` +
      (chainlink.rpcUsed ? ` via ${chainlink.rpcUsed}` : " (all RPCs failed, using API nav_price)"),
  );
  const quotes: Quote[] = buildQuotes(tokens, chainlink.prices);
  const priced = quotes.filter((q) => q.price !== null);
  for (const q of quotes) {
    if (q.price === null) notes.push(`${q.symbol}: no price (Chainlink + API both missing) — held, not traded`);
  }
  if (priced.length === 0) {
    console.log("No prices at all this cycle — nothing to do.");
    return;
  }

  // 2. Snapshot history (momentum needs past closes; cycle 1 warms up).
  const prices: Record<string, number> = {};
  for (const q of priced) prices[q.symbol] = q.price as number;
  state.history.push({ cycle, at, prices });
  if (state.history.length > 60) state.history = state.history.slice(-60);

  // 3. Signals from history.
  const signals = priced.map((q) => {
    const closes = state.history
      .map((h) => h.prices[q.symbol])
      .filter((p): p is number => typeof p === "number" && p > 0);
    return scoreSymbol(q.symbol, closes, q.price as number, q.source);
  });

  // 4. Targets + rebalance plan.
  const portfolio = {
    cashUsd: state.cashUsd,
    positions: state.positions,
    startCapitalUsd: state.startCapitalUsd,
  };
  const value = portfolioValue(portfolio, prices);
  const currentValues = positionValue(portfolio, prices);
  const targets = computeTargets(signals, currentValues, value);
  const isInitial = Object.keys(state.positions).length === 0 && state.cyclesRun === 0;
  const { trades: planned, notes: planNotes } = planRebalance(targets, prices, value, isInitial);
  notes.push(...planNotes);
  if (isInitial) notes.push("initial allocation: turnover cap does not apply on cycle 1");

  // 5. Paper fills at NAV.
  const executed = [];
  for (const t of planned) {
    const ex = applyTrade(portfolio, t, at, cycle);
    if (ex) executed.push(ex);
  }

  // 6. On-chain journal (Sepolia testnet). Skipped gracefully when the
  //    contract is not deployed or no key is configured.
  if (deployment && journalKey) {
    for (const ex of executed) {
      try {
        const tx = await journalWrite(ex);
        ex.journalTx = tx;
        ex.journalStatus = "recorded";
        console.log(`  journal: ${ex.symbol} ${ex.side} -> ${tx}`);
      } catch (err) {
        ex.journalStatus = "failed";
        notes.push(
          `${ex.symbol} journal write failed: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
      }
    }
  } else if (executed.length > 0) {
    notes.push(
      deployment
        ? "journal skipped: TRADE_JOURNAL_KEY not set"
        : "journal skipped: contract not deployed yet (see contracts/deployment-sepolia.json)",
    );
  }

  // 7. Persist state + dashboard snapshot.
  state.cashUsd = portfolio.cashUsd;
  state.positions = portfolio.positions;
  state.cyclesRun = cycle;
  const decision: Decision = {
    cycle,
    at,
    portfolioValueUsd: portfolioValue(portfolio, prices),
    cashUsd: portfolio.cashUsd,
    signals,
    targets,
    trades: executed,
    notes,
  };
  state.decisions.push(decision);
  state.trades.push(...executed);
  saveState(STATE_PATH, state);

  const dashboardExtra = {
    journalAddress: deployment?.address ?? null,
    explorer: SEPOLIA_EXPLORER,
    quotes: priced.map((q) => ({ symbol: q.symbol, price: q.price, source: q.source })),
    universe: UNIVERSE.map((u) => u.symbol),
  };
  writeFileSync(DASHBOARD_STATE_PATH, JSON.stringify(dashboardSnapshot(state, dashboardExtra), null, 2), "utf8");

  // 8. Report.
  printReport(state, decision, prices);
}

function printReport(state: AgentState, decision: Decision, prices: Record<string, number>): void {
  const value = decision.portfolioValueUsd;
  const pnl = value - state.startCapitalUsd;
  console.log(`\n--- Cycle ${decision.cycle} report ---`);
  console.log(`Portfolio value: ${fmtUsd(value)}  (cash ${fmtUsd(decision.cashUsd)})`);
  console.log(`PnL vs ${fmtUsd(state.startCapitalUsd)} start: ${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)} (${fmtPct(pnl / state.startCapitalUsd)})`);
  console.log(`\nSignals:`);
  for (const s of decision.signals) {
    console.log(
      `  ${s.symbol} ${fmtUsd(s.price)} [${s.source}] momentum ${s.momentum === null ? "n/a" : fmtPct(s.momentum)} score ${s.score.toFixed(3)} — ${s.reason}`,
    );
  }
  console.log(`\nTargets:`);
  for (const t of decision.targets) {
    console.log(
      `  ${t.symbol} target ${fmtPct(t.targetWeight)} (${fmtUsd(t.targetValueUsd)}) vs current ${fmtPct(t.currentWeight)} (${fmtUsd(t.currentValueUsd)})`,
    );
  }
  console.log(`\nTrades executed: ${decision.trades.length}`);
  for (const t of decision.trades) {
    console.log(
      `  ${t.side} ${t.tokens.toFixed(6)} ${t.symbol} @ ${fmtUsd(t.price)} = ${fmtUsd(t.valueUsd)} ` +
        `[journal: ${t.journalStatus}${t.journalTx ? ` ${t.journalTx}` : ""}]`,
    );
    console.log(`      ${t.reason}`);
  }
  if (decision.notes.length > 0) {
    console.log(`\nNotes:`);
    for (const n of decision.notes) console.log(`  - ${n}`);
  }
  console.log(`\nState: agent/state.json | Dashboard snapshot: dashboard/state.json`);
}

function runReport(): void {
  const state = loadState(STATE_PATH);
  if (state.cyclesRun === 0) {
    console.log("No cycles run yet. Run: npm run agent:once");
    return;
  }
  const last = state.decisions[state.decisions.length - 1];
  const prices: Record<string, number> = {};
  const lastSnap = state.history[state.history.length - 1];
  if (lastSnap) Object.assign(prices, lastSnap.prices);
  const portfolio = { cashUsd: state.cashUsd, positions: state.positions, startCapitalUsd: state.startCapitalUsd };
  const value = portfolioValue(portfolio, prices);
  const pnl = value - state.startCapitalUsd;
  console.log(`\n=== StockPilot portfolio ===`);
  console.log(`Cycles run: ${state.cyclesRun} | Last cycle: ${last.at}`);
  console.log(`Value: ${fmtUsd(value)} | Cash: ${fmtUsd(state.cashUsd)} | PnL: ${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)} (${fmtPct(pnl / state.startCapitalUsd)})`);
  console.log(`\nPositions:`);
  const values = positionValue(portfolio, prices);
  for (const [symbol, pos] of Object.entries(state.positions)) {
    const price = prices[symbol] ?? 0;
    const v = values[symbol] ?? 0;
    const upnl = v - pos.tokens * pos.avgPrice;
    console.log(
      `  ${symbol} ${pos.tokens.toFixed(6)} tokens @ ${fmtUsd(price)} = ${fmtUsd(v)} (${fmtPct(value > 0 ? v / value : 0)}) avg ${fmtUsd(pos.avgPrice)} unrealised ${upnl >= 0 ? "+" : ""}${fmtUsd(upnl)}`,
    );
  }
  console.log(`\nLast decision (cycle ${last.cycle}): ${last.trades.length} trade(s)`);
  for (const t of last.trades) {
    console.log(`  ${t.side} ${t.tokens.toFixed(6)} ${t.symbol} @ ${fmtUsd(t.price)} [${t.journalStatus}${t.journalTx ? ` ${SEPOLIA_EXPLORER}/tx/${t.journalTx}` : ""}]`);
  }
  console.log(`\nAll trades: ${state.trades.length} | Decisions logged: ${state.decisions.length}`);
}

const cmd = process.argv[2];
if (cmd === "once") {
  await runOnce();
} else if (cmd === "report") {
  runReport();
} else {
  console.log("Usage: node dist/cli.js <once|report>");
  process.exit(1);
}
