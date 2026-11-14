# NEAR SIGNAL

**A read-only NEAR research dashboard that shows its evidence—and its gaps.**

NEAR SIGNAL separates finalized-block observations, current validator data, market context and DeFi TVL. It does not present unobserved measurements as live data, connect wallets, sign transactions, or provide investment advice.

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

- To see live, source-timestamped NEAR RPC, Neardata per-block activity, and market/TVL observations, open the dashboard and wait for the source indicator.
- To inspect how a chart is made, expand **View source query and interpretation** below it.
- To reproduce the Thesis Challenge calculation, expand **View sources, query and calculation** in its result panel, or export the test JSON with its raw inputs, source statuses, timestamps and limitations.
- The **Network Activity & Validators** workspace includes an on-demand account/contract inspector, current validator snapshot, exact finalized-block sample and a local BigQuery SQL generator. SQL generation never submits a job.
- To review the full investment thesis and data caveats, read [`THESIS.md`](THESIS.md) and [track alignment](docs/track-alignment.md).

## Sidebar workspace tools

The desktop sidebar and mobile menu open one module at a time, with direct hash links and browser-back support. Available tools work against live source responses:

- **Value Capture Lab:** execution-budget calculator using the latest finalized gas price; USD equivalent uses a separately sourced market price. Input Tgas is a hypothetical budget, not observed usage.
- **Thesis Challenge Engine:** selectable sourced series, self-correlation guard, direct source/query/method disclosures, and test-result export with raw inputs and limitations.
- **Ecosystem Risk Radar:** source-backed live observations, a live threshold for market/TVL watches, and per-source status and timestamp. Unobserved indicators are omitted rather than shown as blank risk cards.
- **Value Capture Lab:** execution-budget calculator using the latest finalized gas price; USD equivalent uses a separately sourced market price. Input Tgas is a hypothetical budget, not observed usage.
- **Network Activity & Validators:** on-demand mainnet account/contract inspection, current validator participation, exact finalized-block sampling, and a local date/contract SQL builder. SQL generation never runs a BigQuery job.
- **Liquidity & TVL Context:** selectable 7/14/30-day TVL chart windows. The data remains liquidity stock, not net flow.

Every chart has a source recipe, a data table, exact-value CSV download and a copy-query action. Evidence exports preserve selected chart windows, account inspection and calculator inputs. One valid live sample is shown as one point; no prior history or trend is fabricated.

## What is connected

- **Value Capture Lab:** latest finalized-block gas and gas-price estimate, reported chunk utilization, plus separately labeled external market context. The gas estimate is not a reconciled fee ledger or protocol revenue.
- **Ecosystem Risk Radar:** source-backed live observations. Market and TVL threshold watches are shown separately from contextual indicators, with source status and timestamp on each card; missing source data does not create an alert card.
- **Network Activity & Validators:** a complete all-shard transaction sample from FastNEAR Neardata for the exact latest finalized RPC block, plus the current validator-set snapshot and on-demand account state. A single block does not measure daily adoption. The local BigQuery tool only generates a query; it does not display or fabricate results.
- **Liquidity & TVL Context:** daily NEAR DeFi TVL stock. It is not a bridge/Intents net-flow measure.
- **Thesis Challenge Engine:** a selectable descriptive price/TVL/market-volume correlation test. Its source requests, method, source timestamps and limitations are shown with the test and preserved in its export.

## What `npm run rebuild` does

The command first regenerates [`sql/near-signal.sql`](sql/near-signal.sql) from the shared query definition, then fetches the connected public sources and writes [`data/latest-evidence.json`](data/latest-evidence.json). The snapshot records raw returned market/TVL/block inputs, aligned chart series, source times and failures, calculations, query recipes, and disconnected-source states. Browser history retains only the finalized block, chunk-match fields and transaction hashes needed to replay sampled counts; transaction bodies and receipts are discarded.

The command makes **no BigQuery or Intents requests**. It can rebuild the currently connected source data, including one exact-height Neardata bundle, and `npm run replay` can reconstruct charts from the saved finalized block, minimal matched-chunk evidence and transaction hashes without network access. It cannot produce missing daily account/contract/Intents history or turn browser history into a historical chain archive. The full official “rebuild every chart from raw data” goal remains incomplete until those data-access and integration prerequisites are resolved. Missing values stay unavailable.

## Alternative backend ingestion

The browser dashboard now also reads and validates an exact-height FastNEAR Neardata block/shard bundle for its one-block transaction sample; this request is keyless and does not claim daily activity or archive completeness. Separately, a Python CLI reads Neardata with a live-tested block-only FastNEAR RPC fallback, normalized PostgreSQL storage, per-run record observations, and reproducible SQL/Python calculations. An operator-triggered sequential height-range backfill is available with a 100-block default cap and five-second pacing; it is not automatic and does not certify gapless history. Metric persistence is separately opt-in and labels actual observed samples rather than full-day totals. Pikespeak, FastNEAR indexed data, Intear Events and NEAR Intents remain gated by missing credentials or network validation; NearBlocks requires written permission before automated use. A [manual-only Neon Free/GitHub Actions workflow](docs/neon-github-actions.md) is prepared with a bounded one-block run and storage stop, but no Neon database or GitHub secret is configured.

No PostgreSQL URL, driver, Google ADC or BigQuery execution project is configured here. The database schema was not applied and no history was persisted externally. BigQuery remains preserved through the existing parameterized SQL and a new dry-run-only client; no dry run or data query was submitted.

## BigQuery query notes

The authenticated Google Cloud console inspection on 14 November 2026 displayed all 16 objects in `bigquery-public-data.crypto_near_mainnet_us`, including `receipt_origin_transaction` and no `receipt_origin` or `receipts` object. The inspected `transactions`, `receipt_actions`, and `receipt_origin_transaction` tables are partitioned on nullable `block_date` DATE fields. Relevant fields include `transaction_hash` and `signer_account_id` in `transactions`; `signer_account_id`, `receipt_id`, `action_kind`, and `receipt_receiver_account_id` in `receipt_actions`; and `block_date`, `block_height`, `receipt_kind`, `receipt_id`, `data_id`, `originated_from_transaction_hash`, and `_record_last_updated_utc` in `receipt_origin_transaction`. See [`docs/bigquery-live-schema.md`](docs/bigquery-live-schema.md) for the dated inventory and field notes. The inspection used the schema UI only: no query, Preview, dry-run, or billing-enabled project was used.

The sample SQL filters every scanned relation on `block_date`. It defines “daily active accounts” as distinct transaction signer accounts (not verified people) and takes a contract-account parameter for function-call usage. For receipt signer attribution it uses `receipt_actions.signer_account_id` and does not add a redundant `transactions` join. No query was submitted or dry-run. Google Cloud may charge for query processing, so review the estimated bytes and approve spending before any execution.

## NEAR Intents API notes

The official Explorer is read-only and covers historical 1Click Swap records, not every NEAR Intents route. It requires a partner JWT from the Partner Dashboard as `Authorization: Bearer <JWT>`, uses cursor pagination, and documents one request every five seconds per partner. No JWT is configured; no request is made and no token appears in browser code. A successful integration would still need to reconcile `intents.near` settlement with destination-chain/bridge delivery before reporting completed net flow.

## Verification

`npm test` runs 43 deterministic checks, including Neardata chunk-validation, risk evidence, thesis provenance exports, chart query disclosures and source handling. `npm run check` validates JavaScript syntax. The live desktop/mobile suite can be run with `npm install`, `npx playwright install chromium` and `npm run test:e2e`. It uses real read-only providers, tests account lookup, chart/SQL/test/evidence downloads, route visibility and mobile navigation, and asserts that no BigQuery or Intents API request is made. Live providers can fail, impose shared limits or change their terms; the research report and [data-source inventory](docs/data-sources.md) preserve the relevant scope limitations. No synthetic fallback values are used.

## Project notes

- [Investment thesis](THESIS.md)
- [Track alignment, BigQuery schema notes and API blockers](docs/track-alignment.md)
- [Methodology](docs/methodology.md)
- [Data-source inventory](docs/data-sources.md)
- [Alternative data infrastructure and API verification](docs/alternative-data-infrastructure.md)
- [Implementation status](docs/implementation-status.md)
- [Competitor analysis](docs/competitor-analysis.md)

The app is a research tool. It is not an investment recommendation, and the user has not submitted the project to a hackathon or posted it publicly.
