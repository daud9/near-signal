# Bridge and cross-chain settlement risk: NEAR bridge / NEAR Intents

## Verified scope

NEAR Intents 1Click is a cross-chain swap API that routes quotes through market makers and tracks execution. Its documentation says assets move to a quote-specific deposit address and settle on-chain, and that 1Click does not take custody of them. Separately, deposits to the Verifier contract move tokens from the user account into the contract's internal ledger. This creates two distinct risk surfaces: (1) an individual cross-chain order can be delayed, partially deposited, refunded, or fail to deliver; and (2) the Intents Verifier/bridge asset inventory can become an exposure concentration. Neither surface is fully represented by a generic chain TVL number.

The 1Click Explorer API is explicitly read-only and limited to 1Click Swap transactions. Its documented base is `https://explorer.near-intents.org/api/v0`, but every request requires a partner JWT and is rate limited. Therefore it is not an immediately usable anonymous feed for a public risk radar. The ordinary 1Click status endpoint is the most direct operational feed for a known deposit address, but it also requires an API key or JWT according to the OpenAPI schema.

## Authoritative operational endpoints and fields

### 1Click swap lifecycle

* `GET https://1click.chaindefuser.com/v0/status?depositAddress={depositAddress}&depositMemo={depositMemo}`. Required field: `depositAddress`; `depositMemo` is required when the quote used a memo. The response contains `status`, `updatedAt`, `quoteResponse`, and `swapDetails`.
* Status enum: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, and `FAILED`. The quickstart defines `SUCCESS` as tokens delivered to the destination address.
* `swapDetails` fields usable for settlement checks include `depositedAmount`, `amountIn`, `amountOut`, `refundedAmount`, `refundReason`, `originChainTxHashes`, `destinationChainTxHashes`, `nearTxHashes`, and `intentHashes`. The status schema also provides `updatedAt`.
* The quote response supplies `timestamp`, `quote.depositAddress`, optional `depositMemo`, `amountIn`, `amountOut`, `minAmountOut`, `deadline`, `timeWhenInactive`, and `timeEstimate`. `deadline` is the time after which the deposit address becomes inactive and funds may be lost; `timeWhenInactive` is when processing can become slower.
* `GET https://1click.chaindefuser.com/v0/tokens` is public and returns `assetId`, `decimals`, `blockchain`, `symbol`, `price`, `priceUpdatedAt`, optional `contractAddress`, and optional `coingeckoId`. It is useful for normalization and valuation, not for proving reserves or destination delivery.
* `POST https://1click.chaindefuser.com/v0/deposit/submit` can notify 1Click of a known deposit transaction using `txHash` and `depositAddress`; it is an operational acceleration/association endpoint, not an independent settlement attestation.

### NEAR canonical chain evidence

The NEAR JSON-RPC `block` method accepts `finality: "final"` and returns a block header with `hash`, `height`, and nanosecond `timestamp`. The `status` method gives node and validator status; `validators` returns active validators. These fields can establish whether a NEAR-side deposit/withdrawal transaction is finalized and whether the connected RPC is synced, but they cannot prove that an external destination chain has finalized delivery.

Existing FastNEAR inputs are therefore useful for: finality age of NEAR transaction evidence; polling node health/sync; and reading the `intents.near` account or token-contract state when the exact view method and token inventory semantics are known. Generic account balance alone is not a complete cross-chain reserve measure.

### Public aggregate context

DefiLlama's free API documents `GET https://api.llama.fi/protocols`, `GET https://api.llama.fi/protocol/{protocol}`, `GET https://api.llama.fi/tvl/{protocol}`, `GET https://api.llama.fi/v2/chains`, and `GET https://api.llama.fi/v2/historicalChainTvl/{chain}`. Protocol records include `tvl`, `chainTvls`, `change_1d`, and `change_7d`; historical records contain `date` and `totalLiquidityUSD` (protocol) or `tvl` (chain). DefiLlama states that bridge TVL is counted as a bridge-project metric but is not contributed to any chain's TVL. Thus bridge TVL can be a useful shock indicator if the relevant bridge is listed, but chain TVL is not a bridge-reserve or full cross-chain-exposure ledger.

CoinGecko's market-chart endpoint is `GET /api/v3/coins/{id}/market_chart?vs_currency=usd&days={days}` on the documented API host. It returns `[timestamp,value]` pairs in `prices`, `market_caps`, and `total_volumes`. It can supply a USD valuation and market shock baseline for assets identified by 1Click's optional `coingeckoId`; it cannot supply custody, pending-order, solver-liquidity, or destination-delivery evidence.

## Candidate live signals

1. **Known-order pending age / settlement SLA breach (can run now only if the system has a known 1Click deposit address and authorized status access).** Poll `/v0/status`; compute `now - quoteResponse.timestamp` or `now - last known deposit confirmation`, and compare with `quote.quote.timeEstimate`, while separately checking `quote.quote.deadline`. The stronger evidence is `status` remaining `KNOWN_DEPOSIT_TX` or `PROCESSING` with no `destinationChainTxHashes` after a bounded grace period. This is an order-level alert, not a system-wide bridge alert.
2. **Destination-delivery gap (requires authorized 1Click status plus destination-chain evidence, or a public destination explorer/API).** For `SUCCESS`, require a non-empty `destinationChainTxHashes` and independently verify the referenced transaction is finalized on the destination chain. For `PROCESSING`, alert only when the observed age exceeds a defensible multiple of `timeEstimate` and the destination hash remains absent. Impact is high for the affected order; source confidence is high only when both 1Click status and destination finality are independently observed.
3. **Partial/incomplete deposit or refund rate (requires a retained sample of known status records; free public endpoint can be added, but authorization is required).** Count `INCOMPLETE_DEPOSIT`, `REFUNDED`, and `FAILED` over a rolling 1h/24h window divided by all terminal records. Use `depositedAmount`, `amountIn`, `refundedAmount`, and `refundReason` to distinguish underfunding from execution failure. A defensible severity rule is warning at >=5% terminal failures over >=20 records and critical at >=20%; these are operational heuristics, not protocol guarantees, and should be labeled low-to-medium confidence until a baseline is established.
4. **Quote expiry / inactive-address risk (can run with captured quote records and status access).** Alert critical when an observed deposit arrives after `deadline`, or when a pending record is still unresolved at/after `deadline`; warn when current time exceeds `timeWhenInactive` while status is not terminal. Evidence is the signed/captured quote plus timestamped status and deposit transaction. This is a directly documented loss/delay condition, but it is not a proof of loss without the eventual refund/delivery result.
5. **Bridge/project TVL shock (can run now with DefiLlama if the relevant bridge/project slug is present; otherwise it needs a free listing/API check).** From `/protocol/{protocol}` use the historical `chainTvls[chain].tvl[].totalLiquidityUSD` or current `tvl`; compute 1d and 7d percentage change. A conservative alert is warning at <=-20% 1d or <=-30% 7d and critical at <=-40% 1d, only when the observation is not explained by a broad asset-price move. This measures reported bridge/project TVL, not solvency or total cross-chain liabilities; impact can be high but source confidence is medium because adapter coverage, update lag, and token pricing affect it.
6. **1Click flow imbalance (not available from the current anonymous feeds; add the authenticated Explorer API or retained status sample).** With records containing `amountIn`, `amountOut`, `originChainTxHashes`, `destinationChainTxHashes`, asset, chain, and timestamps, compute rolling USD inflow/outflow by chain and asset. Alert on a large net imbalance only relative to a long enough baseline (for example 24h versus 30d same-hour median) and require corroboration from pending ages or destination failures. A threshold such as `abs(net flow) / 30d median daily flow >= 3` is a candidate heuristic, not a defensible universal solvency threshold.
7. **Verifier/asset reserve concentration (can be added via free NEAR RPC only if token inventory view methods and the complete supported asset list are mapped).** Read `intents.near` internal-ledger or token-contract state using the documented NEAR `query`/contract-call surface, normalize raw units using `/v0/tokens.decimals`, and value with 1Click `price` or CoinGecko history. Alert on a sudden reserve decrease only when the same asset's confirmed outgoing withdrawals and pending obligations explain the change. A raw `intents.near` balance or TVL snapshot alone is not enough to infer a reserve deficit.
8. **NEAR-side finality/RPC impairment (runs now with existing FastNEAR RPC feeds).** Poll `status`, `block(finality="final")`, and `validators`; compute finalized block age from header `timestamp`, and detect RPC errors, stale height, or inability to advance across repeated samples. Alert on stale finality only if corroborated by a second public RPC or FastNEAR's finalized-block feed. This is infrastructure availability risk, not bridge solvency risk.
9. **Asset market shock (runs now with existing CoinGecko/DefiLlama prices).** For each tracked origin/destination asset, compute 1h/24h return and realized rolling volatility from `prices`; optionally compare bridge/project TVL in USD against token-denominated or price-adjusted TVL. A price shock is not itself a settlement alert. It should raise impact severity only when paired with pending/failed delivery or a reserve/flow imbalance.

## Current-feed decision matrix

* **Runs now:** NEAR finalized block age/RPC health; broad asset price shock; DefiLlama bridge/project TVL shock where the exact protocol slug is known and listed; direct NEAR account/contract reads that have a verified method and token inventory interpretation.
* **Can be added through a free public endpoint but is not currently complete:** 1Click `/v0/tokens` for metadata; DefiLlama protocol and historical TVL endpoints; CoinGecko market history; a second public NEAR RPC for corroboration. These do not provide full cross-chain exposure.
* **Requires authorization or retained operational records:** per-order 1Click `/v0/status`; Explorer transaction history; aggregate pending age, delivery success, failure/refund rate, and flow imbalance. The Explorer and status OpenAPI docs specify API-key/JWT security.
* **No dependable public source identified in the opened documentation:** a canonical, real-time solver reserve dashboard; full NEAR Intents cross-chain liabilities; a universal bridge pause flag across all underlying bridges; and an authoritative reserve-to-obligation ratio. Do not fabricate these from TVL or from a single contract balance.

## Impact versus source confidence

Impact describes the possible user/system consequence: delayed or missing destination delivery is high; an individual incomplete deposit is medium-to-high for that order; a broad TVL shock or confirmed reserve shortfall is potentially critical; RPC staleness is operationally important but does not establish asset loss. Source confidence is separate: dual-chain transaction evidence and an authenticated status record are high; DefiLlama aggregates and 1Click prices are medium; a single RPC/account snapshot or inferred reserve number is low until its semantics are verified.

No risk alert is asserted in this note. The requested live-read probe was not treated as evidence, and no known deposit address, authorized status sample, historical Explorer export, or verified reserve-liability mapping was supplied. A production alert should be emitted only when the relevant endpoint response and threshold observation are recorded, with timestamp, asset/chain, raw IDs/hashes, and the source-confidence label.

## References

[1]: https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api "1Click Swap API"
[2]: https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits "NEAR Intents deposits"
[3]: https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status "Check swap execution status"
[4]: https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote "Request a swap quote"
[5]: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request "1Click request lifecycle"
[6]: https://1click.chaindefuser.com/docs/v0/openapi.yaml "1Click OpenAPI specification"
[7]: https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction "1Click Explorer API"
[8]: https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens "1Click supported tokens"
[9]: https://docs.near-intents.org/security-compliance/terms-of-service "1Click terms of service"
[10]: https://docs.near.org/api/rpc/introduction "NEAR RPC overview"
[11]: https://docs.near.org/api/rpc/block-chunk "NEAR block and chunk RPC"
[12]: https://docs.near.org/api/rpc/network "NEAR network RPC"
[13]: https://docs.fastnear.com/ "FastNear RPC/API reference"
[14]: https://api-docs.defillama.com/ "DefiLlama API documentation"
[15]: https://docs.llama.fi/ "DefiLlama methodology"
[16]: https://docs.coingecko.com/reference/coins-id-market-chart "CoinGecko market chart endpoint"
