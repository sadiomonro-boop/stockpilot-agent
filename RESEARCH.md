# Base Stocks Maxxing — Research (15 Nov 2026, 00:55 WIB)

## Quest (verified: base.org/stocksmaxxing rendered page + Official Rules)
- Period: 5 Nov – 5 Dec 2026. Submit by **11:59 PM UTC 5 Dec 2026**.
- Entry: (1) public X post with video demo (Loom-style) + tag @buildonbase; (2) Google Form.
- Form: https://docs.google.com/forms/d/1zotYvkeAtDjR2MKk3qNxyNIAfJ_IPQtzTtjNhOAF8js/viewform
- Testnet allowed, NOT judged less favorably. No purchase/payment to enter. Teams ≤5, 18+, not OFAC.
- One submission per track; a project wins in only one track.
- Winners: ID/age/residence + sanctions screening + W-9/W-8 + wallet address, respond within 7 days. Prizes in USDC on Base, normally within 30 days after verification.
- Winners-announcement date: NOT published. No judging-criteria list on the page; no winner counts per track; no "Show us" section found (Rules §3 says the page should have them — it doesn't).

## Prizes (verified from rendered page FAQ + track sections)
- Base track pools: Meme & Community $10,000; **Agentic Stock Finance $20,000**; Programmable Stock Markets $20,000. Total Base $50,000.
- Partner prizes: $48,000 across partners (o1 $2,000; Bankr $1,000 in $BNKR; Stonks free listing; BaseStonk no fee + creator-fee sharing; Feel.cash up to $500; Hydropump $20,000 in credits).
- **Build-in-public award: $6,000, ONE winner, community vote** — share journey on X throughout the season + tag @buildonbase. REALISTIC TARGET alongside the track prize.
- Total $100,000+.

## Agentic Stock Finance track (verified)
- "Build agents that research, earn or trade around tokenized stocks in novel ways."
- Ideas: (1) agents that earn a stock treasury; (2) **research-to-portfolio agents** — track a market narrative, conduct research, manage a portfolio; (3) stock-backed credit for agents; (4) agent-managed rebalancing (rebalancing, trend following, dynamic allocation).
- Launchpads for this track: Bankr, BaseStonk only.

## Eligibility flags
- "Projects that enable trading for US users are not eligible." → Our agent is a personal paper-trading agent for one non-US user, no real trades, no US onboarding. Say so in the README.
- Previously-launched-token teams not eligible by default — we launch NO token.

## Tokenized stocks tech (verified: docs.base.org + live API)
- B20 tokens (Base-native, ERC-20 extension), issued by Coinbase (Coinbase Onchain SPV Ltd, ADGM). **Native precompiles — no per-asset contract on Basescan.** Audited (Base + Spearbit).
- API (no key, read-only): `https://api.coinbase.com/v1/tokenized-stocks` — **358 tokens live** (saved: token-list.json). Fields: contract_address, symbol (e.g. TSLAc), name, decimals (8), isin, adgm_isin, multiplier, nav_price, total_supply. `/chains` → only chain 8453 (Base mainnet) — **NO Sepolia/testnet B20**.
- Multiplier: shares-per-token, changes on corporate actions (dividend → 1.00→1.02; split 10:1 → 1.0→10.0). `balanceOfUI` = raw × multiplier. WAD-scaled (1e18).
- Price: token price = underlying equity price × multiplier. Chainlink V3 feeds (8 decimals, 24/5, total-return values) for 10 majors on Base mainnet:
  AAPL 0x787f13dEa48Db0897CbCDD985de77809D837F988, AMZN 0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295, GOOGL 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2, META 0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D, MSFT 0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c, MSTR 0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a, NVDA 0x04689a41629776563E6822F76f2e57D148d28513, SNDK 0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA, SPCX 0x6A634B235903C4ad6376892180d6fF8612e3Fa68, TSLA 0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4.
- Onchain Registry (multiplier + pause flag): 0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD.
- NAV examples (15 Nov 00:52 WIB): TSLA $387.79, NVDA $160.77, AAPL $355.59, MSFT $522.41, AMZN $265.45, GOOGL $294.89, META $638.54, MSTR $109.50, SPCX $136.54, SNDK $866.83, CRCL $61.22, INTC $58.77. Most of the 358 have no NAV yet (no feed) and no supply (never minted) — thin early market.
- Secondary trading is permissionless; KYC only for mint/redeem (APs). Policies can block sanctioned addresses.

## Chosen entry: "StockPilot" — research-to-portfolio agent (track idea #2)
- Agent reads the token API + Chainlink NAV, runs a deterministic rules-based strategy (momentum/trend + rebalancing to target weights, risk caps), every decision logged with reasons.
- PAPER trades only (virtual $10,000 USDC start, fills at NAV). No real money, no mainnet trading.
- Each paper trade is recorded on-chain via a minimal TradeJournal contract on **Base Sepolia** (testnet, deployer key already has ~0.015 Sepolia ETH) — verifiable audit trail.
- Static dashboard: portfolio value, positions, PnL, trade history, agent reasoning, Sepolia explorer links.
- Deliverables: public GitHub repo (agent + contracts + dashboard + tests), demo video, X post (user posts), Google Form submission.
- Traction reality: main track prizes likely weight traction heavily; a new agent with no users is weak there. Realistic targets: (a) solid technical entry in the $20k Agentic pool, (b) the $6,000 community-voted build-in-public award → post build-in-public updates on X during the season (drafts by Kira, posted by user).

## VM notes
- Public Base RPCs returned empty eth_call results from this VM earlier (1rpc.io rate-limited) — agent must try multiple RPCs and fall back to the REST API nav_price if on-chain reads fail; never depend on one RPC.
- Base USDC checksummed: 0x833589FCD6EdB6E08F4c7C32d4F71B54bd029029.
