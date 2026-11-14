// Agent state: one JSON file holding the paper portfolio, the NAV price
// history (used for momentum), every decision with its reasons, and every
// executed trade. Written atomically (tmp file + rename).

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { START_CAPITAL_USDC } from "./config.js";
import type { AgentState } from "./types.js";

export function emptyState(): AgentState {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    startCapitalUsd: START_CAPITAL_USDC,
    cashUsd: START_CAPITAL_USDC,
    positions: {},
    history: [],
    decisions: [],
    trades: [],
    cyclesRun: 0,
  };
}

export function loadState(path: string): AgentState {
  if (!existsSync(path)) return emptyState();
  const raw = JSON.parse(readFileSync(path, "utf8")) as AgentState;
  if (raw.version !== 1) throw new Error(`unsupported state version ${raw.version}`);
  return raw;
}

export function saveState(path: string, state: AgentState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

/** Public snapshot for the static dashboard (no secrets, no keys). */
export function dashboardSnapshot(state: AgentState, extra: Record<string, unknown>): unknown {
  return {
    updatedAt: new Date().toISOString(),
    startCapitalUsd: state.startCapitalUsd,
    cashUsd: state.cashUsd,
    positions: state.positions,
    cyclesRun: state.cyclesRun,
    lastDecision: state.decisions[state.decisions.length - 1] ?? null,
    recentDecisions: state.decisions.slice(-5).reverse(),
    recentTrades: state.trades.slice(-20).reverse(),
    priceHistory: state.history.slice(-30),
    ...extra,
  };
}
