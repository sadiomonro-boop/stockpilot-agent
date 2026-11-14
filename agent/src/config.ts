// StockPilot configuration. All values are public, deterministic and
// documented in README.md. No secrets live here.

export const API_BASE = "https://api.coinbase.com/v1/tokenized-stocks";

/** Virtual starting capital, USDC. Paper trading only. */
export const START_CAPITAL_USDC = 10_000;

/** The tradable universe: the 10 majors with Chainlink total-return NAV
 *  feeds on Base mainnet (8 decimals, 24/5). API symbol is the B20 symbol. */
export interface UniverseEntry {
  symbol: string; // B20 symbol, e.g. TSLAc
  name: string;
  feed: `0x${string}`; // Chainlink AggregatorV3 on Base (8453)
}

export const UNIVERSE: UniverseEntry[] = [
  { symbol: "AAPLc", name: "Apple Inc.", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  { symbol: "AMZNc", name: "Amazon.com, Inc.", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
  { symbol: "GOOGLc", name: "Alphabet Inc.", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  { symbol: "METAc", name: "Meta Platforms, Inc.", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  { symbol: "MSFTc", name: "Microsoft Corp.", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  { symbol: "MSTRc", name: "Strategy Inc.", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a" },
  { symbol: "NVDAc", name: "NVIDIA Corp.", feed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  { symbol: "SNDKc", name: "SanDisk Corp.", feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA" },
  { symbol: "SPCXc", name: "S&P 500 Index", feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68" },
  { symbol: "TSLAc", name: "Tesla Inc.", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
];

/** Base mainnet RPCs, tried in order. Public RPCs have been flaky from this
 *  VM, so the agent never depends on a single one and falls back to the
 *  Coinbase REST API nav_price when every on-chain read fails. */
export const BASE_RPCS = [
  "https://base-rpc.publicnode.com",
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://1rpc.io/base",
];

/** Base Sepolia (testnet) RPC for the TradeJournal contract. Chain 84532. */
export const SEPOLIA_RPC = "https://sepolia.base.org";
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_EXPLORER = "https://sepolia.basescan.org";

/** Strategy risk parameters (all deterministic, see strategy.ts). */
export const STRATEGY = {
  /** Lookback in cycles for the momentum signal. */
  momentumLookback: 3,
  /** Window in cycles for the trend (SMA) filter. */
  trendWindow: 3,
  /** Momentum is clipped to +/- this before it tilts weights. */
  momentumClip: 0.25,
  /** Tilt strength: weight multiplier = 1 + 2 * score. */
  tiltStrength: 2,
  /** Cash kept uninvested. */
  cashReservePct: 0.05,
  /** No single position may exceed this share of portfolio value. */
  maxPositionPct: 0.2,
  /** Total |buys| + |sells| per cycle, as a share of portfolio value.
   *  Does NOT apply to the initial allocation (cycle 1, empty portfolio). */
  maxTurnoverPct: 0.25,
  /** A rebalance trade is skipped unless it moves the weight by at least
   *  this many percentage points. */
  rebalanceThresholdPct: 0.01,
  /** Trades smaller than this (USD) are skipped as dust. */
  minTradeUsd: 25,
} as const;

/** Chainlink feed ABI (only what we read). */
export const AGGREGATOR_ABI = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
