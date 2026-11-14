# NEAR AI Investment Thesis track alignment

NEAR SIGNAL follows the [official Investment Thesis prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/02-thesis.md): an evidence-first thesis, BigQuery activity SQL, an Intents Explorer data path, a reproducible rebuild, a static dashboard that exposes each chart's query and plain-language meaning, and a `THESIS.md` with evidence for and against the claim plus a result that would change the conclusion.

## BigQuery dataset and documented schema

The target dataset is `bigquery-public-data.crypto_near_mainnet_us`. The authenticated Google Cloud console displayed all 16 objects on 14 November 2026: `account_changes`, `accounts` (view), `blocks`, `chunks`, `circulating_supply`, `execution_outcomes`, `ft_balances_daily`, `ft_events`, `ft_events_contracts_by_account` (materialized view), `nft_events`, `nft_events_contracts_by_account` (materialized view), `receipt_actions`, `receipt_details`, `receipt_origin_transaction`, `transaction_actions`, and `transactions`. No objects named `receipt_origin` or `receipts` appeared. The dated inspection is recorded in [`bigquery-live-schema.md`](bigquery-live-schema.md).

The inspected `transactions`, `receipt_actions`, and `receipt_origin_transaction` tables are partitioned on nullable `block_date` DATE fields. Relevant fields include `transaction_hash` and `signer_account_id` in `transactions`; `signer_account_id`, `receipt_id`, `action_kind`, and `receipt_receiver_account_id` in `receipt_actions`; and `block_date`, `block_height`, `receipt_kind`, `receipt_id`, `data_id`, `originated_from_transaction_hash`, and `_record_last_updated_utc` in `receipt_origin_transaction`. The SQL uses `receipt_actions.signer_account_id` for receipt signer attribution and does not add a redundant `transactions` join.

The console inspection used the schema UI only. It did not run a query, open Preview, perform a dry-run, or enable billing. The app still has no programmatic BigQuery credentials, project, or budget configuration. No BigQuery data query was submitted. Before execution, review BigQuery's bytes estimate and approve spending; the SQL has not been tested against returned data.

The sample query is [in `sql/near-signal.sql`](../sql/near-signal.sql) and is also exposed in the dashboard. It defines daily active accounts as distinct transaction signer accounts, counts distinct transaction hashes, and measures a selected contract's function-call receipts, distinct transactions and distinct signers. These are on-chain account/activity proxies, not people or proof of organic adoption. Each scanned relation has a `block_date` range filter. The query uses `@contract_account_id`; confirm the relation name and every field in BigQuery before running it.

## NEAR Intents Explorer API

The [Explorer API](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) is read-only and covers historical **1Click Swap** transactions and their statuses; it is not a complete index of all NEAR Intents activity. Its base URL is `https://explorer.near-intents.org/api/v0`. Every request requires a JWT from the [Partner Dashboard](https://partners.near-intents.org/) in `Authorization: Bearer <JWT>`. The documented per-partner rate limit is one request every five seconds; transaction history uses cursor-based pagination.

No JWT was supplied or configured, and no Explorer request was made. The token is not included in static browser code. A future flow measure must reconcile raw Explorer records with finalized `intents.near` settlement and destination-chain/bridge delivery or refunds before it is described as completed net flow. Pending, failed, unmatched and refunded legs must remain separate.

## Chart and rebuild reproducibility

Each currently rendered chart has a “View source query and interpretation” disclosure containing its raw API/RPC request or SQL, the exact validation/date-join rule, and one plain-language sentence. The static dashboard fetches connected public providers in the browser; `npm run rebuild` regenerates the checked-in SQL artifact and a dated evidence bundle with connected-source raw responses, aligned chart inputs, query recipes, calculations and unavailable-source statuses. It does not query BigQuery or the Explorer API.

The command therefore rebuilds the currently connected source series and latest block samples, but it cannot recreate unavailable daily-account, contract-history, Intents-flow, or long historical block-sample series. The app intentionally shows those values as unavailable. Full track-level data rebuild remains pending Google Cloud access/schema confirmation and an approved BigQuery query budget, plus an Intents partner JWT and a server-side retrieval path.

The five dashboard modules are **Value Capture Lab**, **Ecosystem Risk Radar**, **Organic Adoption Intelligence**, **Capital Flow Intelligence**, and **Thesis Challenge Engine**. Their evidence boundaries and definitions are documented in the [thesis](../THESIS.md) and [methodology](methodology.md). No hackathon submission or public post was made.
