# NEAR SIGNAL

**A read-only NEAR research dashboard that shows its evidence—and its gaps.**

NEAR SIGNAL separates finalized-block observations, current validator data, market context, DeFi TVL, and unavailable account/flow evidence. It does not connect wallets, sign transactions, or provide investment advice.

The project is served from the existing public [Vercel deployment](https://near-signal-one.vercel.app). The requested update is confined to the existing application, repository and deployment. No new personal profile, hackathon submission, or public post has been created.

## Try it locally

Requirements: Node.js 18 or later. There are no third-party npm runtime dependencies.

```bash
npm test
npm run check
npm run rebuild
npm run dev
```

Then open `http://127.0.0.1:8000`.

- To see live, source-timestamped NEAR RPC and market/TVL observations, open the dashboard and wait for the source indicator.
- To inspect how a chart is made, expand **View source query and interpretation** below it.
- To inspect the daily account/transaction/contract SQL, open **Organic Adoption Intelligence** and expand its sample query. The live schema has been checked, but no BigQuery result is shown because no query was intentionally run.
- To inspect Intents requirements, open **Capital Flow Intelligence**. Its Explorer connection remains unavailable until a partner JWT and safe server-side path are configured.
- To reproduce the written thesis and data caveats, read [`THESIS.md`](THESIS.md) and [track alignment](docs/track-alignment.md).

## What is connected

- **Value Capture Lab:** latest finalized-block gas and gas-price estimate, reported chunk utilization, plus separately labeled external market context. The gas estimate is not a reconciled fee ledger or protocol revenue.
- **Ecosystem Risk Radar:** source-backed, scoped risk cards. Severity and confidence are shown separately; one RPC view is not network-wide health.
- **Organic Adoption Intelligence:** one complete all-shard transaction sample and current validator-set snapshot from NEAR RPC. These do not measure daily adoption. BigQuery daily signer, transaction and contract metrics are displayed as unavailable, with the unexecuted SQL visible.
- **Capital Flow Intelligence:** daily NEAR DeFi TVL stock and source notes. NEAR Intents Explorer is shown as not connected; no net-flow proxy is invented.
- **Thesis Challenge Engine:** a selectable descriptive price/TVL/market-volume correlation test. Its result is not a test of Intents volume versus daily on-chain usage because those two data series are not connected.

## What `npm run rebuild` does

The command first regenerates [`sql/near-signal.sql`](sql/near-signal.sql) from the shared query definition, then fetches the connected public sources and writes [`data/latest-evidence.json`](data/latest-evidence.json). The snapshot records raw returned market/TVL/block inputs, aligned chart series, source times and failures, calculations, query recipes, and disconnected-source states. Browser history retains only the finalized block, chunk-match fields and transaction hashes needed to replay sampled counts; transaction bodies and receipts are discarded.

The command makes **no BigQuery or Intents requests**. It can rebuild the currently connected source data, and `npm run replay` can reconstruct charts from the saved finalized block, minimal matched-chunk evidence and transaction hashes without network access. It cannot produce missing daily account/contract/Intents history or turn browser history into a historical chain archive. The full official “rebuild every chart from raw data” goal remains incomplete until those data-access and integration prerequisites are resolved. Missing values stay unavailable.

## BigQuery query notes

The authenticated Google Cloud console inspection on 14 November 2026 displayed all 16 objects in `bigquery-public-data.crypto_near_mainnet_us`, including `receipt_origin_transaction` and no `receipt_origin` or `receipts` object. The inspected `transactions`, `receipt_actions`, and `receipt_origin_transaction` tables are partitioned on nullable `block_date` DATE fields. Relevant fields include `transaction_hash` and `signer_account_id` in `transactions`; `signer_account_id`, `receipt_id`, `action_kind`, and `receipt_receiver_account_id` in `receipt_actions`; and `block_date`, `block_height`, `receipt_kind`, `receipt_id`, `data_id`, `originated_from_transaction_hash`, and `_record_last_updated_utc` in `receipt_origin_transaction`. See [`docs/bigquery-live-schema.md`](docs/bigquery-live-schema.md) for the dated inventory and field notes. The inspection used the schema UI only: no query, Preview, dry-run, or billing-enabled project was used.

The sample SQL filters every scanned relation on `block_date`. It defines “daily active accounts” as distinct transaction signer accounts (not verified people) and takes a contract-account parameter for function-call usage. For receipt signer attribution it uses `receipt_actions.signer_account_id` and does not add a redundant `transactions` join. No query was submitted or dry-run. Google Cloud may charge for query processing, so review the estimated bytes and approve spending before any execution.

## NEAR Intents API notes

The official Explorer is read-only and covers historical 1Click Swap records, not every NEAR Intents route. It requires a partner JWT from the Partner Dashboard as `Authorization: Bearer <JWT>`, uses cursor pagination, and documents one request every five seconds per partner. No JWT is configured; no request is made and no token appears in browser code. A successful integration would still need to reconcile `intents.near` settlement with destination-chain/bridge delivery before reporting completed net flow.

## Verification

`npm test` runs 28 deterministic checks, including `block_date` filters, chart query disclosures, source handling and calculation tests. `npm run check` validates JavaScript syntax. Live providers can fail, impose shared limits or change their terms; current source status and timestamps are shown in the [source inventory](docs/data-sources.md). No synthetic fallback values are used.

## Project notes

- [Investment thesis](THESIS.md)
- [Track alignment, BigQuery schema notes and API blockers](docs/track-alignment.md)
- [Methodology](docs/methodology.md)
- [Data-source inventory](docs/data-sources.md)
- [Implementation status](docs/implementation-status.md)
- [Competitor analysis](docs/competitor-analysis.md)
- Existing local screenshots and silent walkthrough: [`screenshots/`](screenshots/)

The app is a research tool. It is not an investment recommendation, and the user has not submitted the project to a hackathon or posted it publicly.
