# Metrics and evidence boundaries

## What “live” means

A live signal is a timestamped response from a public provider. It is not an archive, SLA, or independent confirmation. Fetch time and provider observation time are shown separately. A failed or pending request remains unavailable, never zero. Browser-local block history grows only while the page is open.

## Value Capture Lab

The current RPC observation requests a finalized block and its chunks. It estimates block gas cost as `sum(chunk.gas_used) × block.header.gas_price ÷ 10^24` NEAR. Utilization is the reported chunk gas used divided by reported chunk gas limits. These are live block observations, not a full accounting of fees paid or protocol revenue.

NEAR documents separate gas purchase, burning and refunds; a transaction may create later refund receipts. `tokens_burnt` is an execution-outcome field and need not equal `gas_burnt × current gas price`. Contract rebate rules also changed by protocol version (the current docs distinguish protocol versions through 86 from version 87 onward). A durable value-capture analysis must reconcile finalized transaction/receipt outcomes, block-specific gas prices, protocol-version parameters, refunds, issuance, epoch rewards and treasury flows. It must not equate gross gas deductions with tokenholder return. No historical fee ledger or BigQuery query is connected.

## Organic Adoption Intelligence

The app's existing NEAR RPC transaction count covers every shard chunk in one sampled finalized block. Each chunk must have a transaction array and match the block's referenced shard ID, hash and inclusion height; an incomplete sample is withheld. For up to 60 recent browser-local observations, the evidence export retains the finalized block, each matched chunk’s shard/hash/inclusion fields and transaction hashes so the sample count can be replayed. Full transaction bodies and receipt payloads are discarded. This is not a daily transaction series or user measure.

The unexecuted BigQuery template defines daily activity as distinct `transactions.signer_account_id` values and distinct transaction hashes per `block_date`. Contract usage is restricted to `FUNCTION_CALL` and a selected `receipt_receiver_account_id`; receipt signer attribution uses `receipt_actions.signer_account_id`, with the origin relation `receipt_origin_transaction` available for origin linkage. It reports distinct originating transactions, signers and function-call receipts separately. Accounts are on-chain proxies, not people; receipts, actions and transactions are not interchangeable. The sample is [`sql/near-signal.sql`](../sql/near-signal.sql); no BigQuery result is displayed.

Every BigQuery query must constrain the relevant relation on `block_date` and select only needed columns. The authenticated schema inspection confirmed the 16-object inventory and the `block_date` DATE partition on `transactions`, `receipt_actions`, and `receipt_origin_transaction`; see [`bigquery-live-schema.md`](bigquery-live-schema.md). The app has no programmatic BigQuery integration. No query, Preview, or dry-run was run, and the SQL has not been tested against returned data.

## Ecosystem Risk Radar

Risk cards keep severity (potential impact) separate from confidence (source quality, freshness and completeness). The configurable 5–50% decline threshold applies only to the 24-hour CoinGecko price change and 30-day DefiLlama TVL change. A threshold crossing is an investigation prompt, not a security incident. Current-set validator concentration is descriptive and has no validated alert cutoff. One provider's status is not network-wide uptime. Missing multi-provider, historical, operator-identity, bridge and security evidence remains unknown rather than low risk.

## Capital Flow Intelligence

CoinGecko's market volume is gross exchange turnover. DefiLlama TVL is a daily USD-denominated asset stock; price movement and provider coverage can change it without deposits or withdrawals. The chart joins exact UTC dates and excludes the partial current date; gaps are not filled.

The NEAR Intents Explorer is documented as read-only history for 1Click Swap records. It requires a Partner Dashboard JWT as a Bearer token and is limited to one request every five seconds per partner. No token or API pull is configured. Explorer statuses alone do not establish final destination delivery. A future net-flow ledger must reconcile asset/chain direction, `intents.near` settlement, bridge/destination evidence, refunds and pending legs; no TVL or transaction-count proxy is labeled net flow.

## Thesis Challenge Engine

The selectable test aligns daily price, TVL or gross-market-volume observations by exact date, computes each series' daily percentage change, and calculates Pearson's `r` on the selected number of consecutive matched dates. A visible ±0.30 threshold is a product rule, not a validated statistical cutoff. No p-value, causality, forecast, or user-adoption inference is made. The current control cannot test the official Intents-volume-versus-on-chain-activity hypothesis because those datasets are unavailable.

## Rebuilding the charts

Every currently displayed chart includes a disclosure with its source request or SQL, the matching/validation rule, and a plain-language sentence. Browser observations retain the raw finalized block and the minimal chunk verification fields plus transaction hashes; full transaction bodies and receipt payloads are discarded; `npm run replay` reconstructs charts from saved evidence without network access. `npm run rebuild` refreshes connected sources before replay and regenerates the shared BigQuery SQL artifact and dated evidence JSON. It does not call BigQuery or the Intents API. It cannot reconstruct missing daily/contract/Intents histories or treat browser history as a chain archive; those stay unavailable. This is a reproducible rebuild for connected inputs, not yet a complete rebuild of every intended track metric.

## Overall NEAR Ecosystem Health Score

The overall score is withheld. Daily retention, complete capital flows, historical fees, application/dependency concentration and multi-provider infrastructure history are not measured well enough for a defensible composite. No unavailable dimension is assigned a placeholder value.

## Workspace tools

The account inspector requests `query` with `request_type: view_account`, `finality: final` and a validated NEAR account ID from the same public mainnet RPC. It shows returned balance (not a spendable quote), locked amount, storage, code-hash presence and finalized block height. Raw request/response and fetch time are exportable. It does not infer account history, people or organic adoption. Reads are user-initiated and at least five seconds apart.

The execution calculator multiplies a user-entered hypothetical Tgas budget by the latest observed block gas price. USD conversion uses the available timestamped market price. Missing live inputs stay unavailable; storage and other charges are excluded. It is not a transaction quote or revenue forecast.

The local SQL builder validates the account and an inclusive 1–31-day date range, then declares an exclusive next-day end bound for the shared partition-filtered query. Generating or downloading it sends no warehouse request. Chart CSVs contain exact plotted values, and evidence replay preserves the selected chart windows.
