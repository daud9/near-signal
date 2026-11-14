# NEAR SIGNAL — Investment Thesis

## Claim

NEAR's long-term investment case depends on sustained, broad on-chain activity and cross-chain settlement translating into durable protocol-level value capture. The [official Investment Thesis prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/02-thesis.md) suggests testing whether NEAR Intents cross-chain volume is a better leading indicator of real network usage than token price.

**Current conclusion: not established; the available market evidence argues for caution.** Connected sources show a dated decline in price, TVL and gross market volume, but the data required to test organic activity, Intents settlement and protocol-wide value capture are not connected. This is an evidence assessment, not investment advice.

## Evidence that cuts against a bullish growth reading

The dated evidence snapshot generated **14 November 2026 at 18:00 UTC** contains 31 matched daily market/TVL dates from **14 October to 13 November**. Across those dates, the NEAR price endpoint fell **32.11%** (about $5.04 to $3.42), NEAR DeFi TVL fell **34.53%** (about $243.1 million to $159.2 million), and gross market-volume endpoint fell **63.62%** (about $1.12 billion to $408.4 million). These are provider-reported USD observations; they are not net investment, on-chain activity, protocol revenue, or user counts.

From 30 October to 13 November, price was down **15.61%**, TVL **14.41%**, and gross market volume **57.34%**. Over the seven-day span, price was down **6.54%**, TVL **7.98%**, and gross market volume **33.61%**. These endpoint changes describe that sample only; they do not predict future performance.

The default selectable test found Pearson **r ≈ 0.98** between 14 matched daily price and TVL changes from 31 October to 13 November. Both series declined. “Supported” in the interface means same-direction co-movement under a visible product threshold; it does not mean growth, causal influence, statistical significance, or a forecast.

## What the live chain sample does—and does not—show

The refreshed snapshot recorded finalized block **224,548,963** at **18:00:52 UTC**, protocol version **88**. All **10** referenced shard chunks were verified and the sampled block contained **15 transactions**. This is one block, not a daily trend or user count.

The RPC-reported current validator set contained **355 records**. The top ten held **35.91%** of stake in that returned set; the reported stake HHI was **216.31**, and returned epoch counters showed **99.99%** block production (**24,631/24,633**). The current block-level gas estimate was **0.012119 Ⓝ**. These are provider observations, not a historical validator series, full delegation map, protocol-wide fee ledger, or security guarantee.

At the same refresh window, CoinGecko reported NEAR at **$3.12**, down **10.63%** over 24 hours at **18:00:51 UTC**. DefiLlama reported **$3.1375** at **18:00:42 UTC**, nine seconds earlier. They are timestamped market observations, not on-chain price or value-capture measures.

At a separate **19:35 UTC** Risk Radar check, FastNEAR reported **11 prior-epoch validator kickouts**, including sampled `NotEnoughChunkEndorsements` results of 0 / 43,198 expected endorsements. DefiLlama reported **USN at $0.0862599**, about **91.37% below $1**, with $69,854 in NEAR-chain circulation. These represent high impact for affected validators and critical token-level peg stress, respectively; neither proves chain halt or ecosystem insolvency. Eight selected NEAR protocol histories were checked and none crossed the seven-day TVL alert threshold. See the [timestamped risk research](docs/risk-radar-research/README.md).

## Evidence needed to test the broader thesis is unavailable

Public chain and [NEAR Intents Explorer documentation](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) describe data that could inform the missing tests. Documentation and endpoint availability do not establish that the dashboard has complete, authorized historical data or that the missing metrics are increasing. The Intents Explorer covers historical 1Click swaps only and requires partner access.

## What is unknown or cuts against the hypothesis

- No daily active signer-account series, daily transaction trend, contract-function-call history, or account-retention cohort is connected. A signer account is not a person, and activity counts do not prove organic or non-incentivized usage.
- No NEAR Intents swap-volume data is connected. The Explorer covers 1Click swaps only, not every Intents route, and a status record alone does not prove final destination delivery.
- The live gas estimate is a recent block-level calculation, not a reconciled fee ledger. It does not account for finalized refunds, protocol-version changes, issuance, epoch rewards, treasury flows or economic beneficiaries; it cannot establish tokenholder value capture.
- TVL is a USD-denominated asset stock and can move with token prices or provider coverage. Gross exchange volume is turnover, not chain transactions or directional net capital flow.
- No multi-provider uptime history, multi-epoch validator trend, complete app/contract inventory or bridge/security dependency history is available.

Missing data is neither support nor disproof. It leaves the working hypothesis untested.

## What would change my mind

I would move toward supporting the long-term thesis if a reproducible period of at least 90 days showed sustained or broadening daily signer activity and contract calls, meaningful returning-account cohorts under a published definition, and rising finalized Intents completions reconciled across deposits, `intents.near` settlement and destination delivery. A separate protocol-version-aware ledger would need to reconcile `tokens_burnt`, refund receipts, issuance, validator rewards and treasury flows before I would claim durable value capture.

I would move against the thesis if those validated series showed persistent activity contraction, usage concentrated in a shrinking set of accounts/contracts, a large share of Intents records failing or not completing at destination, or fee burns remaining small relative to issuance and rewards throughout the measured period. Definitions, date ranges, thresholds and exclusions must be published before evaluating the result.

## Methodology and connected data sources

The app reads [FastNEAR's public mainnet RPC](https://free.rpc.fastnear.com) for finalized blocks/chunks, node status and validator/kickout data; CoinGecko for price, market capitalization, gross market volume and daily history; and DefiLlama for independent spot price, [daily NEAR TVL](https://api.llama.fi/v2/historicalChainTvl/near), selected [protocol histories](https://api.llama.fi/protocols) and [stablecoin price/NEAR circulation](https://stablecoins.llama.fi/stablecoins?includePrices=true). Each observation retains its provider or local check time and response status. The [source inventory](docs/data-sources.md) lists cadence and scope. Inside the Thesis Challenge Engine, exact chart requests, observation times, calculation steps and limitations appear beside the result and in its JSON export; risk cards disclose their own observed values, thresholds and reproduction queries.

Daily market and TVL series are matched on exact UTC dates, exclude the partial current day and never fill missing dates. A 30-day endpoint change requires 31 consecutive dates. The descriptive test first calculates percentage changes between exactly consecutive daily observations, then pairs changes on their UTC end date and requires the complete selected window of 7, 14 or 30 consecutive matched changes. Pearson r describes co-movement only; ±0.30 is a product rule, not a significance threshold, and no p-value or causal estimate is calculated. Each finalized-block transaction sample requires every newly included shard chunk to match the finalized block's hash, shard ID and inclusion height; earlier-height references contribute zero. Risk severity and evidence confidence are separate. Stablecoin, protocol TVL and validator rules have specialized observed thresholds; the configurable decline threshold still applies only to market/30-day ecosystem TVL signals. Calculations are deterministic and tested; no source gaps are filled. See the [full definitions](docs/methodology.md).

## Intents API access

The Explorer is read-only historical **1Click Swap** coverage at `https://explorer.near-intents.org/api/v0`. Its docs require a partner JWT from the [Partner Dashboard](https://partners.near-intents.org/) in `Authorization: Bearer <JWT>`, use cursor-based pagination and limit requests to one every five seconds per partner. No token is configured and no request is made. A future integration must keep the JWT server-side and reconcile records with finalized settlement and destination-chain/bridge evidence.

## Rebuild and track status

Run `npm test`, `npm run check`, then `npm run rebuild`. The rebuild refreshes connected public-source responses and writes `data/latest-evidence.json` with market/TVL/block and risk inputs, aligned chart data, source statuses and times, observed risk states, calculations and query recipes. `npm run replay` reconstructs charts from an existing evidence file without network access. Each displayed chart discloses its source request or calculation, derivation and plain-language meaning.

This rebuild covers currently connected inputs, not every intended track metric: daily account and contract histories, Intents-flow records and a long historical block archive remain unavailable. Protocol TVL monitoring covers only up to eight eligible DefiLlama rows, not every dApp. Stablecoin snapshots lack provider price timestamps and cannot prove redemption or reserves. No universal keyless NEAR APR/APY endpoint is connected, so the app does not fabricate a yield alert. Browser observations retain the raw finalized block and only the matched-chunk fields and transaction hashes needed to replay sampled counts; full transaction bodies and receipt payloads are discarded. Missing indicators stay unavailable rather than being displayed as placeholders. See [track alignment](docs/track-alignment.md), [methodology](docs/methodology.md), the [data-source inventory](docs/data-sources.md) and [risk research](docs/risk-radar-research/README.md). No hackathon submission or public post was made.
