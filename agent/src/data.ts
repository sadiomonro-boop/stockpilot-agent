// Data layer: Coinbase Tokenized Stocks API (paginated, no key) and
// Chainlink NAV feeds on Base mainnet via viem, with multi-RPC fallback.
// Rule: never depend on a single RPC. If every on-chain read fails, fall
// back to the REST API nav_price; a symbol with no price at all is marked
// unavailable and is never traded that cycle.

import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import {
  AGGREGATOR_ABI,
  API_BASE,
  BASE_RPCS,
  UNIVERSE,
} from "./config.js";
import type { ApiToken, PriceSource, Quote } from "./types.js";

export interface TokenListResult {
  tokens: ApiToken[];
  source: "live-api" | "local-fallback";
  pages: number;
}

const FETCH_TIMEOUT_MS = 20_000;

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "StockPilot/1.0" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

/** Fetch the full token list, following next_page_token (100/page).
 *  Falls back to the bundled snapshot if the live API is unreachable. */
export async function fetchTokenList(
  localPath: string,
): Promise<TokenListResult> {
  try {
    const tokens: ApiToken[] = [];
    let pageToken: string | null = null;
    let pages = 0;
    do {
      const url =
        pageToken === null
          ? API_BASE
          : `${API_BASE}?page_token=${encodeURIComponent(pageToken)}`;
      const data = (await fetchJson(url)) as {
        tokens?: ApiToken[];
        next_page_token?: string | null;
      };
      if (!Array.isArray(data.tokens)) throw new Error("unexpected API shape");
      tokens.push(...data.tokens);
      pages += 1;
      pageToken = data.next_page_token ?? null;
      if (pages > 20) throw new Error("too many pages, aborting");
    } while (pageToken);
    return { tokens, source: "live-api", pages };
  } catch (err) {
    const raw = JSON.parse(readFileSync(localPath, "utf8")) as {
      tokens: ApiToken[];
    };
    return { tokens: raw.tokens, source: "local-fallback", pages: 0 };
  }
}

export interface ChainlinkResult {
  prices: Record<string, number>; // symbol -> USD (8-dec feed)
  perFeed: Record<string, { ok: boolean; rpc: string | null; error?: string }>;
  rpcUsed: string | null;
}

/** Read all 10 Chainlink feeds, trying each RPC in order until one answers
 *  for a feed. A feed that fails on every RPC is reported, not fatal. */
export async function fetchChainlinkNavs(
  rpcs: string[] = BASE_RPCS,
): Promise<ChainlinkResult> {
  const prices: Record<string, number> = {};
  const perFeed: ChainlinkResult["perFeed"] = {};
  let rpcUsed: string | null = null;

  for (const entry of UNIVERSE) {
    let done = false;
    for (const rpc of rpcs) {
      try {
        const client = createPublicClient({
          chain: base,
          transport: http(rpc, { timeout: 10_000 }),
        });
        const result = (await client.readContract({
          address: entry.feed,
          abi: AGGREGATOR_ABI,
          functionName: "latestRoundData",
        })) as [bigint, bigint, bigint, bigint, bigint];
        const answer = result[1];
        if (answer <= 0n) throw new Error("non-positive answer");
        prices[entry.symbol] = Number(answer) / 1e8;
        perFeed[entry.symbol] = { ok: true, rpc };
        rpcUsed = rpc;
        done = true;
        break;
      } catch (err) {
        perFeed[entry.symbol] = {
          ok: false,
          rpc: null,
          error: err instanceof Error ? err.message.slice(0, 120) : String(err),
        };
      }
    }
    if (!done && !perFeed[entry.symbol]) {
      perFeed[entry.symbol] = { ok: false, rpc: null, error: "no RPC tried" };
    }
  }
  return { prices, perFeed, rpcUsed };
}

/** Merge Chainlink + API into one quote per universe symbol.
 *  Priority: Chainlink total-return NAV, then API nav_price, else unavailable. */
export function buildQuotes(
  tokens: ApiToken[],
  chainlink: Record<string, number>,
): Quote[] {
  const bySymbol = new Map(tokens.map((t) => [t.symbol, t]));
  return UNIVERSE.map((entry) => {
    const cl = chainlink[entry.symbol];
    if (typeof cl === "number" && Number.isFinite(cl) && cl > 0) {
      return {
        symbol: entry.symbol,
        price: cl,
        source: "chainlink" as PriceSource,
        updatedAt: null,
      };
    }
    const api = bySymbol.get(entry.symbol);
    if (api && typeof api.nav_price === "number" && api.nav_price > 0) {
      return {
        symbol: entry.symbol,
        price: api.nav_price,
        source: "api" as PriceSource,
        updatedAt: api.nav_price_updated_at ?? null,
      };
    }
    return {
      symbol: entry.symbol,
      price: null,
      source: "unavailable" as PriceSource,
      updatedAt: null,
    };
  });
}
