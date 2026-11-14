# StockPilot — research-to-portfolio agent for tokenized stocks

**Entry for the Base Stocks Maxxing — Agentic Stock Finance track ($20,000 pool).**
Deadline: 5 Dec 2026 23:59 UTC. Research notes: [RESEARCH.md](RESEARCH.md).

StockPilot is a deterministic, rules-based agent that tracks market
narratives, conducts research, and manages a portfolio of Coinbase
tokenized stocks (B20) on Base — on paper. It reads live data, scores
each stock, rebalances to target weights under risk caps, logs every
decision with its reasons, and mirrors every paper trade on-chain in a
`TradeJournal` contract on Base Sepolia (testnet) as a verifiable audit
trail.

## What it does

1. **Data** — Coinbase Tokenized Stocks API (358 stocks, no key,
   paginated) + Chainlink total-return NAV feeds on Base mainnet for the
   10 majors (AAPL, AMZN, GOOGL, META, MSFT, MSTR, NVDA, SNDK, SPCX,
   TSLA). Public Base RPCs are flaky, so the agent tries several RPCs
   and falls back to the REST API `nav_price` when on-chain reads fail.
2. **Strategy (deterministic, explainable)** — momentum over 3 cycles
   (clipped ±25%) with a trend filter (never overweight a name below
   its moving average); equal base weights tilted by score; max 20%
   per position, max 25% turnover per cycle, 5% cash reserve. The
   first cycle has no history, so it says so and starts with an
   equal-weight allocation; momentum tilts begin as history accrues.
3. **Paper trading** — virtual $10,000 USDC starting capital, fills at
   NAV, no fees, no slippage, no leverage, no shorting.
4. **Audit trail** — each paper trade is recorded on-chain via
   `TradeJournal.recordTrade(symbol, side, amount, price, reasonHash)`
   on Base Sepolia, emitting an event per trade.
5. **Dashboard** — static page (`dashboard/`) rendering portfolio
   value, positions, PnL, trade history with Sepolia explorer links,
   and the agent's latest reasoning.

## Run it

```bash
cd agent
npm install
npm test            # strategy + portfolio unit tests, API parsing (live)
npm run agent:once  # one full cycle: fetch -> decide -> trade -> journal
npm run agent:report
```

The journal write needs a deployed contract and a key:

```bash
# Deploy (testnet only; key via env, never committed):
DEPLOYER_KEY=0x... ./script/deploy-sepolia.sh
# Then run a cycle with journaling:
TRADE_JOURNAL_KEY=0x... npm run agent:once
```

Without a key/address the journal step is skipped and the paper trades
still run locally. View the dashboard with any static server:

```bash
cd dashboard && python3 -m http.server 8000
# open http://localhost:8000
```

## Contracts

- `contracts/TradeJournal.sol` — owner-only `recordTrade`, `TradeRecorded`
  event, `getTrade(id)`. Tests: `forge test` (9 tests).
- Deployment (Base Sepolia): see `contracts/deployment-sepolia.json`
  after running the deploy script.

## Honest disclaimers

- **Paper trading only.** No real money, no mainnet trading, no token
  launched, no custody. The agent never touches real stocks or funds.
- **Not investment advice.** The strategy is a simple momentum/rebalance
  ruleset for a hackathon demo; it is not a recommendation to buy or
  sell anything.
- **Not available to US users.** This is a personal paper-trading agent
  for one non-US user; there is no US-user onboarding and nothing here
  enables trading for US users.
- Tokenized-stock prices come from Coinbase's API and Chainlink feeds;
  most of the 358 tokens have no NAV feed and no supply yet (thin early
  market). The agent only trades the 10 majors with live NAV.
- Past paper performance says nothing about future results.
