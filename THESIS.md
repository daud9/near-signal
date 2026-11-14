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

The RPC-reported current validator set contained **355 records**. The top ten held **35.91%** of stake in that returned set; the reported stake HHI was **216.31**, and returned epoch counters showed **99.99%** block production (**24,631/24,633**). The current block-level gas estimate was **0.012119 Ⓝ**. These are current provider observations, not a historical validator series, full delegation map, protocol-wide fee ledger, or security guarantee.

At the same refresh window, CoinGecko reported NEAR at **$3.12**, down **10.63%** over 24 hours at **18:00:51 UTC**. DefiLlama reported **$3.1375** at **18:00:42 UTC**, nine seconds earlier. They are timestamped market observations, not on-chain price or value-capture measures.

## Evidence that could support the thesis, but has not yet been measured

NEAR's [public BigQuery guide](https://docs.near.org/data-infrastructure/big-query) documents historical transaction, receipt/action, execution-outcome, block/chunk and account-change data. The [Intents Explorer API](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) documents historical 1Click Swap records. Those sources could support the relevant tests after their schemas, access and coverage are validated. Their existence is not evidence that the missing metrics are increasing.

## What is unknown or cuts against the hypothesis

- No daily active signer-account series, daily transaction trend, contract-function-call history, or account-retention cohort has been queried. A signer account is not a person, and activity counts do not prove organic or non-incentivized usage.
- No NEAR Intents swap-volume data has been pulled. The Explorer covers 1Click swaps only, not every Intents route, and a status record alone does not prove final destination delivery.
- The live gas estimate is a recent block-level calculation, not a reconciled fee ledger. It does not account for finalized refunds, protocol-version changes, issuance, epoch rewards, treasury flows or economic beneficiaries; it cannot establish tokenholder value capture.
- TVL is a USD-denominated asset stock and can move with token prices or provider coverage. Gross exchange volume is turnover, not chain transactions or directional net capital flow.
- No multi-provider uptime history, multi-epoch validator trend, complete app/contract inventory or bridge/security dependency history is available.

Missing data is neither support nor disproof. It leaves the working hypothesis untested.

## What would change my mind

I would move toward supporting the long-term thesis if a reproducible period of at least 90 days showed sustained or broadening daily signer activity and contract calls, meaningful returning-account cohorts under a published definition, and rising finalized Intents completions reconciled across deposits, `intents.near` settlement and destination delivery. A separate protocol-version-aware ledger would need to reconcile `tokens_burnt`, refund receipts, issuance, validator rewards and treasury flows before I would claim durable value capture.

I would move against the thesis if those validated series showed persistent activity contraction, usage concentrated in a shrinking set of accounts/contracts, a large share of Intents records failing or not completing at destination, or fee burns remaining small relative to issuance and rewards throughout the measured period. Definitions, date ranges, thresholds and exclusions must be published before evaluating the result.

## Methodology and connected data sources

The app reads [FastNEAR's public mainnet RPC](https://free.rpc.fastnear.com) for finalized blocks/chunks, node status and the current validator response; CoinGecko for price, market capitalization, gross market volume and daily history; and DefiLlama for an independent spot price and [daily NEAR TVL](https://api.llama.fi/v2/historicalChainTvl/near). Each observation retains its provider/fetch timestamps and status. The [source inventory](docs/data-sources.md) lists cadence and scope. Inside the Thesis Challenge Engine, the exact CoinGecko and DefiLlama requests, observation times, calculation steps and limitations appear alongside the result and are preserved in its JSON export.

Daily market and TVL series are matched on exact UTC dates, exclude the partial current day and never fill missing dates. A 30-day endpoint change requires 31 consecutive dates. The descriptive test first calculates percentage changes between exactly consecutive daily observations, then pairs changes on their UTC end date and requires the complete selected window of 7, 14 or 30 consecutive matched changes. Pearson r describes co-movement only; ±0.30 is a product rule, not a significance threshold, and no p-value or causal estimate is calculated. Each finalized-block transaction sample requires every newly included shard chunk to match the finalized block's hash, shard ID and inclusion height; earlier-height references contribute zero. Risk severity and evidence confidence are separate, and the configurable decline threshold applies only to market/TVL signals. Calculations are deterministic and tested; no source gaps are filled. The [full definitions](docs/methodology.md) record the remaining limitations.

## BigQuery tables, fields and sample SQL

The dataset is `bigquery-public-data.crypto_near_mainnet_us`. On 14 November 2026, the authenticated Google Cloud console displayed 16 objects: `account_changes`, `accounts` (view), `blocks`, `chunks`, `circulating_supply`, `execution_outcomes`, `ft_balances_daily`, `ft_events`, `ft_events_contracts_by_account` (materialized view), `nft_events`, `nft_events_contracts_by_account` (materialized view), `receipt_actions`, `receipt_details`, `receipt_origin_transaction`, `transaction_actions`, and `transactions`. No objects named `receipt_origin` or `receipts` appeared. See [`docs/bigquery-live-schema.md`](docs/bigquery-live-schema.md).

The console inspection showed `transactions`, `receipt_actions`, and `receipt_origin_transaction` partitioned on nullable `block_date` DATE fields. It also confirmed `transactions.transaction_hash` and `transactions.signer_account_id`; `receipt_actions.signer_account_id`, `receipt_id`, `action_kind`, and `receipt_receiver_account_id`; and the origin fields `block_date`, `block_height`, `receipt_kind`, `receipt_id`, `data_id`, `originated_from_transaction_hash`, and `_record_last_updated_utc`. The schema UI inspection did not run a query, open Preview, perform a dry-run, or enable billing. **No BigQuery query was submitted.** Google may charge for query processing, so review estimated bytes and approve spending before running the [sample SQL](sql/near-signal.sql). It counts distinct transaction hashes and signing accounts per day, then counts function-call receipts, transactions and signers for a contract parameter. Every scanned relation is filtered on `block_date`; receipt signer attribution uses `receipt_actions.signer_account_id` without a redundant `transactions` join. The SQL has not been tested against returned data.

## Intents API access

The Explorer is read-only historical **1Click Swap** coverage at `https://explorer.near-intents.org/api/v0`. Its docs require a partner JWT from the [Partner Dashboard](https://partners.near-intents.org/) in `Authorization: Bearer <JWT>`, use cursor-based pagination and limit requests to one every five seconds per partner. No token was configured and no request was made. A future integration must keep the JWT server-side and reconcile records with finalized settlement and destination-chain/bridge evidence.

## Rebuild and track status

Run `npm test`, `npm run check`, then `npm run rebuild`. The rebuild regenerates the SQL file from the shared query definition and writes `data/latest-evidence.json` with connected public-source responses, aligned market/TVL chart inputs, query recipes, calculations and disconnected-source states. Each current dashboard chart displays its source request or query, derivation and a plain-language description.

This is a static dashboard with a rebuild for the sources currently connected, **not yet a complete rebuild of every intended track metric**: no BigQuery or Explorer data is fetched, and browser-local block histories are not an archive. Browser observations retain the raw finalized block and only the matched-chunk fields and transaction hashes needed to replay sampled counts; full transaction bodies and receipt payloads are discarded. `npm run replay` reconstructs charts from saved evidence without network access; `npm run rebuild` refreshes connected sources before replay. Those metrics stay unavailable until the remaining access, cost, and integration prerequisites are met. See [track alignment](docs/track-alignment.md), [methodology](docs/methodology.md) and [data-source inventory](docs/data-sources.md). No hackathon submission or public post was made.
