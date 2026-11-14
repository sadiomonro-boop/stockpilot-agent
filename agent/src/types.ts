// Shared types for StockPilot.

export interface ApiToken {
  contract_address: string;
  symbol: string;
  name: string;
  decimals: number;
  isin?: string;
  multiplier?: number;
  nav_price?: number | null;
  nav_price_updated_at?: string | null;
  total_supply?: number | null;
}

export type PriceSource = "chainlink" | "api" | "unavailable";

export interface Quote {
  symbol: string;
  price: number | null; // USD, total-return NAV
  source: PriceSource;
  updatedAt: string | null;
}

export interface Signal {
  symbol: string;
  price: number;
  source: PriceSource;
  /** (last / k-th previous close) - 1, null when history is too short. */
  momentum: number | null;
  /** Simple moving average of the recent closes, null when too short. */
  sma: number | null;
  /** price > sma, null when unknown. */
  trendUp: boolean | null;
  /** Momentum clipped to +/- momentumClip, forced <= 0 when trending down. */
  score: number;
  reason: string;
}

export interface Target {
  symbol: string;
  targetWeight: number;
  currentWeight: number;
  targetValueUsd: number;
  currentValueUsd: number;
}

export type TradeSide = "BUY" | "SELL";

export interface PlannedTrade {
  symbol: string;
  side: TradeSide;
  tokens: number;
  price: number;
  valueUsd: number;
  reason: string;
}

export interface ExecutedTrade extends PlannedTrade {
  at: string;
  cycle: number;
  journalTx: string | null;
  journalStatus: "recorded" | "skipped" | "failed";
}

export interface Decision {
  cycle: number;
  at: string;
  portfolioValueUsd: number;
  cashUsd: number;
  signals: Signal[];
  targets: Target[];
  trades: ExecutedTrade[];
  notes: string[];
}

export interface Position {
  tokens: number;
  avgPrice: number;
}

export interface PriceSnapshot {
  cycle: number;
  at: string;
  prices: Record<string, number>;
}

export interface AgentState {
  version: 1;
  createdAt: string;
  startCapitalUsd: number;
  cashUsd: number;
  positions: Record<string, Position>;
  history: PriceSnapshot[];
  decisions: Decision[];
  trades: ExecutedTrade[];
  cyclesRun: number;
}
