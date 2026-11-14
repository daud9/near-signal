# NEAR inflation, staking rewards, gas burn, and sell-pressure context

## Verified protocol facts

NEAR’s current validator documentation states that the yearly reward budget is **2.5% of total supply**. **10% of that budget goes to the protocol treasury** and the rest is shared by validators in proportion to stake. The same page describes the validator-side annual yield as approximately **2.25% × total supply ÷ total stake**; rewards that validators do not earn are not minted, and uptime/performance affects eligibility. This is a protocol-level issuance budget, not a guaranteed wallet APR, and it excludes validator commission, pool fees, compounding, and any external incentive. [1]

The validator documentation also states that transaction fees are burned. On protocol version 86 and earlier, contracts received 30% of gas burned as a rebate, so that portion was not burned; from protocol version 87 (nearcore 2.14.0), all of it is burned. The inflationary validator reward is paid at the same rate regardless of fees collected or burned. Therefore, fee burn can offset issuance at the network level, but it is not evidence that a particular holder is experiencing net deflation or selling. [1]

NEAR’s October 2025 tokenomics announcement describes a proposed/upgrade-gated reduction of maximum inflation from 5% to approximately 2.5%, effective only after 80% of block-producing-validator stake adopted it. It models approximately 4.75% staking rewards if 50% of total supply is staked. The announcement also describes separate House of Stake programs: a proposed 100,000 NEAR annual small-validator budget and a proposed veNEAR pilot whose modeled reward rates were above base staking. These are incentive-program claims and assumptions, not proof that every program is live, funded, or available to every staker. [2]

The older NEAR supply article documents the original launch model: 5% annual additional supply, 90% to validators and 10% to the protocol treasury, with 30% of transaction fees rebated and 70% burned. That historical 5%/70% description must not overwrite the current validator documentation’s 2.5%/protocol-v87 burn rules. [3]

## What the available APIs do and do not expose

The official RPC reference confirms JSON-RPC methods including `status`, `block`, `query`, `validators`, `gas_price`, `genesis_config`, and `EXPERIMENTAL_protocol_config`; requests are POSTs to a provider root. [4] FastNEAR’s public reference describes the `validators` request type as returning the active validator set for the current epoch, with stakes and performance statistics. Its NEAR Data API provides recent optimistic/finalized blocks and headers, including a latest-finalized-block redirect. [5] [6]

Neither the official RPC reference nor FastNEAR’s validator reference documents a live expected staking APR/APY field. The honest implementation is therefore to derive a protocol-level estimate from the documented budget and observed stake, and label it an estimate. A practical formula is:

`protocol_validator_apr_estimate = 0.0225 × total_supply / total_active_stake`

where `total_active_stake` is the sum of validator stake fields from the current `validators` response. The estimate should be recomputed at each finalized epoch boundary and should not be called a wallet’s net APR. A more conservative range can use the 2.5% budget before the treasury allocation (`0.025 × total_supply / total_active_stake`) as a gross budget ceiling, then report the 2.25% validator-share estimate separately.

The presently described FastNEAR/RPC inputs include block, status, validators, and account views, but no documented total-supply field in those surfaces. CoinGecko’s documented `coins/{id}/market_chart` endpoint returns timestamped `prices`, `market_caps`, and `total_volumes`, but market-cap divided by price is only a market-data supply proxy, not a canonical protocol supply read. [7] Do not silently substitute it for total supply in a high-confidence issuance alert. A canonical supply input would need to be added from a free, documented source or a protocol state read whose supply field is verified.

## Reproducible candidate signals

1. **Protocol issuance estimate (can run only if canonical total supply is added).** Read the current finalized `validators` response and sum active validator stake. Read a verified total-supply field at the same epoch or timestamp. Compute the formula above. Test evidence: raw endpoint responses, block/epoch identifier, parsed stake sum, supply, numerator (2.25%), and resulting annualized estimate. Severity: informational when the estimate changes; high impact only if a verified protocol parameter changes materially. Source confidence is high for the 2.5%/10%/2.25% rules, but only as high as the supply read and epoch alignment.

2. **Observed realized validator reward rate (can run with current chain feeds only if epoch reward deltas are available).** For a fixed validator or staking-pool account, sample `account`/state balance at finalized epoch boundaries and separately account for deposits, withdrawals, and validator commission. Annualize reward-only delta over a rolling 7–30 day window. Do not infer rewards from balance changes without excluding transfers and unstaking. Test evidence: finalized block heights, account IDs, balance deltas, transaction/receipt exclusions, and epoch duration. Severity: warning only for a sustained deviation from the derived protocol estimate after data-quality checks; no alert on a single epoch.

3. **Fee-burn versus issuance context (can run with current block/Neardata samples, but requires verified transaction/receipt fee fields).** Over a rolling 7-day or 30-day window, sum burned-fee amounts from finalized block/receipt execution data and compare with the expected issuance budget for the same period. Report `net_protocol_supply_pressure = estimated_issuance - observed_burn`; do not call this sell pressure. Test evidence: finalized block range, fee/burn field paths, sum, period length, and issuance denominator. Severity: informational until both sides are complete and schema-validated. The official rule that protocol v87 burns all collected fees supports interpreting the burn side, but does not by itself provide a live burn total. [1] [6]

4. **External incentive/APY excess (free public endpoint may be added; not supplied by current feeds).** Use a documented public yield endpoint only when it returns a named pool/market, chain, asset, timestamp, `apy`/`apyBase`/`apyReward` (or equivalent), TVL, and reward-token identity. DefiLlama’s API documentation lists yields as a data family but states that the free `/pools` and `/chart/{pool}` endpoints shut down on 2026-11-13 and the replacements `/yields/v1/pools` and `/yields/v1/chart/{pool}` require the API plan. [8] Therefore no paid endpoint may be assumed here. If a free endpoint is later verified, flag `external_yield_exceeds_protocol` only when the same asset/lock/period is comparable and `reported_total_apy > derived_protocol_apr + tolerance` for at least two observations 24 hours apart. Test evidence must include pool ID, TVL, reward token, observation timestamps, and the exact APY fields. Severity: medium impact for incentive dependency, high only with sustained APY plus falling TVL or reward-token liquidity; source confidence is separate and depends on provider methodology.

5. **Market sell-pressure context (can run with current CoinGecko price/market-cap/volume feed, but cannot prove selling).** Compute rolling price return, volume/market-cap ratio, and drawdown from `prices`, `market_caps`, and `total_volumes`. These are market stress proxies, not token-flow evidence. A defensible alert requires a predeclared rule such as 7-day drawdown below -20% and 7-day volume/market-cap above the asset’s own 90-day 95th percentile, confirmed at two daily observations. Label it “market stress coincident with issuance/incentive context,” never “staking sell pressure,” unless direct exchange/netflow or wallet-flow data is added and verified. [7]

## Explicit non-claims and limitations

No current public API verified here provides a live, universal expected staking APR for NEAR. It must be derived, and the result depends on canonical supply, active stake, epoch timing, performance, commission, and pool terms. The 4.75% figure in the 2025 announcement is conditional on approximately 50% of supply being staked, not a live guarantee. [2]

Protocol issuance, fee burn, external rewards, price weakness, and net sell pressure are different observables. The connected feeds can support chain state, validator-set, block, price, volume, and TVL checks, but they do not establish that stakers sold NEAR, that rewards were immediately sold, or that a protocol incentive caused market selling. Do not emit a sell-pressure risk alert from inflation or APY alone.

DefiLlama chain TVL/spot price can provide ecosystem context, but TVL is not staking participation and a price feed is not a transfer-flow feed. CoinGecko historical market data supplies arrays of timestamp/value pairs; it does not identify sellers or reward recipients. [7] A dependable attribution of sell pressure would require verified exchange netflows, labeled wallet flows, or equivalent primary transfer data, none of which is part of the stated current feed set.

## References

[1]: https://docs.near.org/protocol/network/validators "NEAR Docs: Validators"
[2]: https://www.near.org/blog/supporting-community-proposals-to-upgrade-near-tokenomics-halving-inflation-and-introducing-rewards-to-support-small-validators-and-venear-holders "NEAR: Supporting Community Proposals to Upgrade NEAR Tokenomics"
[3]: https://www.near.org/blog/near-token-supply-and-distribution "NEAR: NEAR Token Supply and Distribution"
[4]: https://docs.near.org/api/rpc/introduction "NEAR Docs: Protocol Call Reference"
[5]: https://docs.fastnear.com/rpc/validators/validators-current "FastNEAR: Current Validators"
[6]: https://docs.fastnear.com/neardata/last-block-final "FastNEAR: Last Final Block Redirect"
[7]: https://docs.coingecko.com/reference/coins-id-market-chart "CoinGecko: Coin Historical Chart Data by ID"
[8]: https://api-docs.defillama.com/ "DefiLlama API Documentation"
