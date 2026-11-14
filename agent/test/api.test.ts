// API tests: live fetch of the Coinbase Tokenized Stocks API (with one
// retry) plus deterministic parsing of the bundled snapshot. Run with:
// npm test

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildQuotes, fetchChainlinkNavs, fetchTokenList } from "../src/data.js";
import { UNIVERSE } from "../src/config.js";

const HERE = dirname(fileURLToPath(import.meta.url)); // agent/dist/test
const LOCAL_LIST = join(HERE, "..", "..", "token-list.json");

test("live API: paginated fetch returns the full token list", async () => {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { tokens, source, pages } = await fetchTokenList(LOCAL_LIST);
      assert.equal(source, "live-api");
      assert.ok(tokens.length >= 300, `expected >=300 tokens, got ${tokens.length}`);
      assert.ok(pages >= 3, `expected >=3 pages, got ${pages}`);
      const tsla = tokens.find((t) => t.symbol === "TSLAc");
      assert.ok(tsla, "TSLAc present");
      assert.equal(tsla.decimals, 8);
      assert.ok(typeof tsla.nav_price === "number" && tsla.nav_price > 0);
      assert.ok(typeof tsla.contract_address === "string");
      assert.ok(tsla.contract_address.startsWith("0x"));
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
});

test("bundled snapshot parses: 358 tokens, fields intact", () => {
  const raw = JSON.parse(readFileSync(LOCAL_LIST, "utf8")) as {
    tokens: Record<string, unknown>[];
  };
  assert.equal(raw.tokens.length, 358);
  const symbols = new Set(raw.tokens.map((t) => t["symbol"]));
  for (const u of UNIVERSE) assert.ok(symbols.has(u.symbol), `missing ${u.symbol}`);
  const withNav = raw.tokens.filter((t) => typeof t["nav_price"] === "number");
  assert.ok(withNav.length >= 10, `expected >=10 with nav_price, got ${withNav.length}`);
});

test("buildQuotes: Chainlink wins, then API nav, then unavailable", () => {
  const tokens = [
    { symbol: "TSLAc", contract_address: "0x1", name: "Tesla", decimals: 8, nav_price: 100 },
    { symbol: "AAPLc", contract_address: "0x2", name: "Apple", decimals: 8, nav_price: 200 },
  ];
  const quotes = buildQuotes(tokens, { TSLAc: 387.79 });
  const tsla = quotes.find((q) => q.symbol === "TSLAc")!;
  const aapl = quotes.find((q) => q.symbol === "AAPLc")!;
  const msft = quotes.find((q) => q.symbol === "MSFTc")!;
  assert.equal(tsla.source, "chainlink");
  assert.equal(tsla.price, 387.79);
  assert.equal(aapl.source, "api");
  assert.equal(aapl.price, 200);
  assert.equal(msft.source, "unavailable");
  assert.equal(msft.price, null);
});

test("Chainlink feeds: read path always returns a complete per-feed report", async () => {
  // Public Base RPCs are flaky from this VM; the agent must survive a total
  // failure (API fallback). The invariant under test: fetchChainlinkNavs
  // never throws and reports ok/error for every feed, so the caller can
  // decide. Success count is logged, not asserted — RPC reachability from
  // this VM is an environment property, not agent logic.
  const res = await fetchChainlinkNavs();
  assert.equal(Object.keys(res.perFeed).length, UNIVERSE.length);
  for (const entry of UNIVERSE) {
    const f = res.perFeed[entry.symbol];
    assert.ok(f, `missing report for ${entry.symbol}`);
    if (!f.ok) assert.ok(typeof f.error === "string" && f.error.length > 0);
  }
  const okCount = Object.values(res.perFeed).filter((f) => f.ok).length;
  const prices = Object.values(res.prices);
  for (const p of prices) assert.ok(p > 0 && Number.isFinite(p));
  console.log(`  (Chainlink feeds ok: ${okCount}/${UNIVERSE.length}${res.rpcUsed ? ` via ${res.rpcUsed}` : " — all RPCs failed, API fallback applies"})`);
});
