# NEAR Ecosystem Risk Radar — research index

The Risk Radar uses direct observations where a free, reproducible public input supports a real rule. It does not fill an unavailable security, bridge, or yield measurement with a placeholder. **Impact severity** and **source confidence** are separate: a serious-looking value can still have limited provenance.

## Live checks that produced real findings

**USN peg stress — critical token-level finding.** At 2026-11-14 19:35 UTC, the connected [DefiLlama stablecoin endpoint](https://stablecoins.llama.fi/stablecoins?includePrices=true) returned USN at **$0.08625988408**, approximately **91.37% below $1**, with **$69,854** of reported NEAR-chain circulation. That is **0.053%** of the USD-pegged NEAR circulation covered by the same response. A ≥5% single-check deviation is a critical token-level alert; the feed supplies no provider price timestamp or redemption evidence, so source confidence is moderate. It is not an ecosystem-wide insolvency claim.

**Validator performance — high for affected operators.** The [FastNEAR validator RPC](https://free.rpc.fastnear.com) returned epoch 4970, 355 current validators and **11 previous-epoch kickouts**. Sampled kickouts included `centurion.poolv1.near` and `cryptotribe.poolv1.near`, reported with `NotEnoughChunkEndorsements` and 0 of 43,198 produced/expected endorsements. These are direct prior-epoch records from one RPC snapshot, not proof of a chain halt or malicious behavior. The sampled response did not produce a current slashing alert.

**Protocol liquidity — watched, no threshold crossing in the captured sample.** At the same time the app read eight large non-CEX NEAR protocol histories from [DefiLlama’s protocol API](https://api.llama.fi/protocols). Seven-day changes were Rhea Lend **−17.10%**, NEAR Intents **−23.83%**, Meta Pool Near **−15.82%**, RHEA LST **−15.60%**, NEAR Bridge **−13.45%**, LiNEAR Protocol **−18.78%** and Rhea Dex **−14.87%**; KAIO was **+0.16%**. None crossed the −30% seven-day alert rule. A change in USD TVL can reflect market prices or adapter coverage as well as balances; it does not establish net withdrawals or insolvency.

These live checks are point-in-time evidence. The dashboard refreshes them while open, reports source response/freshness, exports the response-derived risk states, and reruns the calculations from dated observations. A failed source is never read as zero risk.

## Seven researched risk domains

1. **DeFi yield and APR sustainability:** [research note](01-defi-yield.md) explains reward-versus-fee yield, lending utilization, pool liquidity, and why headline APR/APY is not a fraud verdict. DefiLlama’s free public yield routes returned 404 on 14 November after their retirement on 13 November 2026; replacement routes require the API plan. No paid source, invented yield, or generic APY alert is used.
2. **Contract/admin control:** [research note](02-contract-admin.md) covers finalized code hashes, FullAccess keys, function-call permissions, upgrades, NEP-330 metadata, and reproducible builds. These require a known verified contract account and contract-specific interpretation; absence of a contract inventory is not itself an alert.
3. **Liquidity, stablecoins and assets:** [research note](03-liquidity-assets.md) documents chain-specific TVL, peg-price and circulation evidence, asset depegs, and the distinction between a market quote and redemption/reserve proof. The app implements only the public, validated aggregate rules.
4. **Bridge and NEAR Intents settlement:** [research note](04-bridges-intents.md) separates 1Click order status, final delivery, Verifier balances and bridge exposure. Status/Explorer histories require a partner JWT or retained operational records, so no order-failure or reserve-deficit alert is fabricated.
5. **Validator performance:** [research note](05-validators.md) covers current-set concentration, previous-epoch kickouts, slashing flags, production counters and limits of a single RPC provider. The implemented card surfaces only direct kickout/slashing fields.
6. **Finality, network and shard congestion:** [research note](06-network.md) defines finalized-height progress, provider disagreement, per-shard gas and receipt-pressure rules, including which require repeated samples or independent sources. One healthy or unhealthy response does not establish network-wide availability.
7. **Tokenomics and rewards:** [research note](07-tokenomics.md) distinguishes the current protocol reward budget, fee burn, historical rules and proposed incentives. A canonical supply and aligned epoch data are needed before calculating protocol APR; inflation, TVL or market volume alone does not prove sell pressure.

## Implemented thresholds and coverage

- **Stablecoin depeg:** critical at ≥5% below/above the $1 reference on one check; high at ≥3% on two checks; moderate at ≥1% on two checks within the last 72 hours. Only USD-pegged assets with positive reported NEAR circulation are assessed. Browser-local history records repeated prices; it is not a chain archive.
- **NEAR protocol TVL:** at most the eight largest reported non-CEX protocol rows with NEAR-chain TVL ≥$100,000. High at ≤−20% over a dated observation window near 24 hours or ≤−30% over approximately seven days; critical at ≤−40% / ≤−50%, respectively. No missing daily value is interpolated; the card reports actual dates. This is not full dApp or contract coverage.
- **Validators:** prior-epoch kickouts create a high-impact finding for affected operators; a protocol-reported `is_slashed=true` flag is classified separately as critical. Neither condition alone means a network halt.
- **Market and ecosystem drawdown:** the existing user-adjustable threshold still applies only to CoinGecko’s 24-hour NEAR change and a complete 30-day DefiLlama ecosystem-TVL change.

See the dashboard’s [Risk Radar](https://near-signal-one.vercel.app/#risk-radar), [methodology](../methodology.md), [source inventory](../data-sources.md) and [official thesis](../../THESIS.md) for live disclosure, request recipes and the broader product boundary. Each individual research note includes source links and the conditions needed to make its candidate signals defensible.
