# Metrics and risk methodology

## What “live” means here

A live signal is a timestamped response from a public provider; it is not a durable archive, a guaranteed service level, or an independent confirmation of every other provider. The app displays fetch time separately from provider observation time. A failed or pending request remains unavailable, never zero. The local snapshot and browser-local block history are dated evidence, not continuously hosted data.

## Finalized-block activity and gas

The app requests NEAR RPC `block` with `finality: "final"`. For the sampled block it requests every referenced shard through `chunk` using the block height and shard ID. It counts the block only if every response has a transaction array and matches the referenced `shard_id`, `chunk_hash`, and `height_included`. Any missing or inconsistent chunk withholds the full-block count. The official chunk response does not expose a separate `block_hash` field; the check therefore uses the fields the documented schema actually supplies.

The browser polls the finalized block approximately once per minute and samples the all-shard transaction count on load, then no more often than once every five minutes. Transaction identities, transaction contents and receipts are discarded; only the block metadata, referenced chunk hashes, per-shard counts, total count and timestamps are retained. This is one block’s count, not a daily series, unique-user count, or adoption/retention measure.

The block gas-cost estimate is:

`sum(chunk.gas_used) × block.header.gas_price ÷ 10^24 yoctoNEAR per Ⓝ`

It is a block-level estimate from reported fields, not protocol revenue, validator profit, or a complete measure of transaction fees. Gas utilization is summed reported gas used divided by summed reported chunk gas limits. Missing or invalid gas fields make these estimates unavailable.

## Current validator set

`validators([null])` provides the RPC-reported current active set. Top-ten stake share is the ten largest reported stakes divided by stake in that returned set. HHI is `10,000 × sum(validator_share²)`. The displayed production ratio is total returned produced blocks divided by expected blocks when every counter is valid. The result describes one current set/epoch response only; it does not represent every staker, historic performance, decentralization in all dimensions, or a security audit.

## Market and TVL observations

CoinGecko supplies the timestamped spot snapshot, 24-hour price change, market capitalization, gross 24-hour market volume, and daily market arrays. DefiLlama supplies an independent timestamped spot price and daily NEAR DeFi TVL. The spot-price difference is shown only when both positive prices have valid provider timestamps no more than five minutes apart.

TVL is a daily USD-denominated stock across provider-covered DeFi protocols. It can change with asset prices or coverage and is not net inflow, liquidity retained, or new investment. CoinGecko volume is aggregated gross exchange activity, not on-chain transfer volume or net capital flow. The current partial UTC day is excluded from daily matching. Dates are joined exactly; missing dates are not interpolated.

## Complete window changes

For `d` elapsed days, the app requires `d + 1` complete, consecutive UTC-dated observations. It compares the first and last values in that span:

`(last value − first value) ÷ abs(first value) × 100`

The supported windows are 7, 14 and 30 days. Thus a seven-day change requires eight daily points. This is an endpoint-to-endpoint change, not a comparison of two window averages. If a date is missing, either endpoint is invalid, or the start value is zero, the change is unavailable.

## User-selected hypothesis test

The interface lets the user choose two daily series (price, TVL or gross market volume), an expected positive/negative relationship, and 7, 14 or 30 matched daily changes. It computes each series’ day-over-day percentage changes, joins them on date, and computes Pearson’s `r` on exactly the selected number of consecutive observations. The free-text hypothesis label is only a description; it does not alter the calculation.

The product rule treats `r ≥ 0.30` as support for a positive relationship and `r ≤ −0.30` as support for a negative one; a strong correlation in the opposite direction is “Not supported,” while a value between those thresholds is “Partially supported.” Missing/incomplete dates or a constant series return “Insufficient evidence.” The threshold is a visible UI rule, not a validated statistical cutoff. No p-value, causal attribution or forecast is calculated. The daily changes may be autocorrelated, and two market-related series are not independent proof of adoption.

## Risk radar

Each card separates its state, severity, historical trend, evidence, confidence and suggested next check. The default decline threshold is 20%, adjustable from 5% to 50%; it applies only to the CoinGecko 24-hour price change and the 30-day DefiLlama TVL change. Crossing it is a prompt to investigate, not proof of a failure or security event. Validator concentration is shown descriptively without a validated alert threshold. Adoption remains unrated because one block sample cannot establish adoption. Infrastructure describes the queried provider’s current block/status, not network-wide uptime.

## NEAR Ecosystem Health Score

The overall NEHS is deliberately withheld. Capital resilience, user retention, complete app/contract concentration, dependency history and multi-source infrastructure history are not covered well enough to assign a defensible score. Any proposed category weights remain design ideas, not model parameters.

## Evidence boundaries

The app distinguishes provider facts from derived changes and from unavailable dimensions. “Unknown” is not zero. No fabricated fallback values are used. A current RPC response is not a long-run trend; a high-confidence count can still have low interpretive scope. Endpoint and plan details can change, so review the [source inventory](data-sources.md) and [provider research](live-data-research.md) before any public release.
