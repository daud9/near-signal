# Alternative NEAR data infrastructure

## What works now

NEAR SIGNAL now has a server-side, read-only ingestion path for FastNEAR Neardata, a block-only FastNEAR public RPC fallback, a unified normalized-record model, PostgreSQL DDL and persistence adapter, source-scoped Python calculations, and reproducible PostgreSQL query examples. The static dashboard remains separate and has not been given provider keys or a database connection.

A live Neardata read returned HTTP 200 after following the documented `/v0/last_block/final` redirect. The adapter validated all 10 shard chunk hashes and inclusion heights before accepting the block's 15 transaction rows (sample block 224,536,570, observed 14 November 2026). A live `/v0/first_block` request resolved to block 9,820,210. These tests establish that those endpoints and returned records were accessible at that time; they do not prove gapless archival history, completeness across every block, or a numeric request quota. The block and transaction JSON is normalized to small evidence records; signatures, public keys and opaque function-call arguments are not persisted.

A later production-page check on block 224,544,213 found one shard reference with `height_included` 224,544,212 and no new chunk payload; the other newly included chunks matched. This is a reused prior-height chunk, so it contributes zero transactions to block 224,544,213 rather than making the sample incomplete or recounting its old transactions. The live dashboard and optional Python adapter now validate every newly included chunk, account for earlier-height references as zero, and retain regression tests for both cases.

If Neardata's latest-block request fails, the optional fallback fetches one finalized block from the already-used FastNEAR public JSON-RPC endpoint. That fallback is explicitly block-only: it does not create transaction history, daily activity, or adoption metrics. Its source identity is kept separate in PostgreSQL provenance.

## Provider access checks

Tests below were read-only and performed on 14 November 2026. “Reachable” means the host responded; it does not mean the account, API scope, or historical coverage is authorized or complete.

| Provider | Actual access check | Authentication, limits, and history | Decision |
|---|---|---|---|
| [NearBlocks API](https://api.nearblocks.io/api-docs) | Official API documentation and [Terms](https://nearblocks.io/terms) were reachable. **No data API endpoint was called** because the Terms bar automated collection and third-party applications without prior written consent. | API docs describe a Bearer API key after plan activation. Published Free tier: 10 calls/minute, 420/day, 12,500/month; higher tiers differ. Docs describe block/date filters and cursors, but no earliest history floor or completeness guarantee. | Blocked until written permission and an authorized plan/key are in place. Do not probe or ingest before then. |
| [Pikespeak API](https://api.pikespeak.ai/docs) | Docs and OpenAPI were reachable. The data endpoint was not called because it requires `x-api-key`, and none is configured. | Plans publish Free 10 calls/minute and 10,000/month; Alpha 5/second and 150,000/month; On-demand has no numeric quota in the reviewed docs. Some endpoints support cursors; no general earliest history floor or completeness SLA was found. | Adapter remains disabled until an authorized key is supplied and one minimal data response can be validated. |
| [FastNEAR indexed API](https://docs.fastnear.com/api) | `GET https://api.fastnear.com/status` returned HTTP 200. This is a status endpoint, **not** a test of indexed account/asset data. | Indexed data docs require a FastNEAR API key. The account-transaction API documents block-height filters, opaque resume-token pagination and a per-page limit up to 200; no numeric request quota or global retention floor was found. | Indexed-data adapter remains disabled until an authorized key is available. Do not mistake Neardata's public cursor for unrestricted FastNEAR indexed-history access. |
| [FastNEAR Neardata](https://docs.fastnear.com/neardata) | `GET https://mainnet.neardata.xyz/v0/last_block/final` returned a documented redirect to a block; the adapter followed it and validated actual block/shard data. `GET /v0/first_block` resolved to height 9,820,210 in this test. | No API key was required for the tested block cursors. No numeric request-rate limit was published in the reviewed docs. The first cursor identifies a returned starting block but does not establish gapless archival completeness or retention guarantees. | Implemented for one-block collection, explicit heights, and an operator-triggered bounded range backfill. The backfill is sequential, defaults to 100 heights with a 5-second delay, and never runs automatically; this pacing is conservative client behavior, not a provider-approved quota. |
| [Intear Events API](https://docs.intear.tech/docs/events-api/) | The documented `wss://ws-events-v3.intear.tech/...` hostname failed DNS resolution before a WebSocket handshake; therefore there is no HTTP status or authorization result. A separate `GET https://api.intea.rs/schema` did return HTTP 200, but that is a different service. | Events docs describe real-time WebSocket events but no historical replay, cursor, floor, retention or numeric Events-host quota. Limits/no-key statements for the separate `api.intea.rs` service must not be assumed for the Events host. | Not connected; retry from a DNS-capable environment and confirm the Events-host terms/auth/limits before implementing. |
| [NEAR Intents Explorer](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) | The live read-only `GET /api/v0/transactions?numberOfTransactions=1` request reached the host and returned HTTP 400 with an empty body, without authorization. This is reachability only, not authorized data access. | A partner JWT is required. The documented partner limit is one request every five seconds; page size is up to 1,000. Cursor filters cover historical **1Click Swaps only**; the docs state no earliest floor, retention period, or completeness guarantee. | Adapter remains disabled until a partner JWT is configured server-side and an authenticated response is validated. Do not call this all Intents activity or net flow. |
| [NEAR public BigQuery dataset](https://docs.near.org/data-infrastructure/big-query) | A metadata-only unauthenticated `GET https://bigquery.googleapis.com/bigquery/v2/projects/bigquery-public-data/datasets?maxResults=1` returned HTTP 401 `CREDENTIALS_MISSING`. No query, preview, job or dry run was sent. The dataset schema was previously inspected in the authenticated Console; its 16-object inventory is in [`bigquery-live-schema.md`](bigquery-live-schema.md). | Public data does not mean anonymous query-job access. A different authenticated Google identity can work with OAuth/ADC, a selected execution project, `bigquery.jobs.create` (typically `roles/bigquery.jobUser`), access to the public dataset, API access and compatible organization/VPC policy. Google documents the BigQuery sandbox as a no-billing-account path for public data and a 1 TiB/month free query tier; excess use can cost money. | Preserve BigQuery as the preferred historical analysis path. A dry-run-only client is implemented, but no project or ADC is configured here, so no dry run was performed. |

Provider sources opened for these checks include [Pikespeak plans](https://pikespeak.ai/plans), [FastNEAR auth](https://docs.fastnear.com/auth), [FastNEAR transaction API](https://docs.fastnear.com/tx), the [Intear API schema](https://api.intea.rs/schema), the [Intents Explorer transaction docs](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/transactions), [Google public datasets](https://docs.cloud.google.com/bigquery/public-data), [BigQuery sandbox](https://docs.cloud.google.com/bigquery/docs/sandbox), [BigQuery IAM](https://cloud.google.com/bigquery/docs/access-control), and [Google ADC](https://cloud.google.com/docs/authentication/provide-credentials-adc). Published limits are provider documentation, not load tests.

## BigQuery without the unavailable Console project

A separate Google account, user ADC, service-account impersonation, or workload identity can provide a different authenticated configuration; none removes the need for an execution project and `bigquery.jobs.create` when submitting a query job. The safe next path is to authenticate an authorized identity, select an existing eligible project or the BigQuery sandbox, confirm minimum IAM and organization policy, and parameterize a bounded query. No billing/API/resource settings were changed here.

`ingestion/bigquery_dry_run.py` can submit only a `jobs.insert` request with `configuration.dryRun=true`; it has no query-execution path. It requires `NEAR_SIGNAL_BIGQUERY_PROJECT`, Google Application Default Credentials, explicit start/end dates and a contract account. The existing [`sql/near-signal.sql`](../sql/near-signal.sql) remains generated from the shared query registry, with `block_date` filters on scanned relations. The dry run is **not yet validated against Google** because this environment has no project or ADC. No BigQuery result or historical metric is claimed.

## Storage, lineage, and reproducibility

The PostgreSQL schema in [`sql/postgres-schema.sql`](../sql/postgres-schema.sql) creates:

- `ingestion_sources` for provider identity, authentication/access status, documented rate limits, historical-coverage notes and terms.
- `ingestion_runs` for request metadata, response status/hash, timestamps, row counts and failures.
- `normalized_records` for blocks, transactions, account snapshots, decoded events and intent swaps, with source endpoint, provider/collection times, stable record IDs, payload hash, and normalized identifiers.
- `normalized_record_observations` for every source-record/run pairing, retaining the request endpoint, original compact payload/hash, provider and collection times, and ingestion-run link when the latest normalized entity is re-fetched.
- `metric_observations` for non-null numeric measurements, source, period, provider/collection/calculation times, input count and hash, SQL/Python method name/version and dimensions. Metric IDs include the calculation version, so later code versions do not overwrite earlier results.

The shared normalizer rejects missing/non-finite metric values rather than turning them into zero. The Python calculations in [`ingestion/calculations.py`](../ingestion/calculations.py) aggregate only records actually supplied, keep providers separate, do not fill missing dates, do not identify signer addresses as people, and do not report Intents net flow or cross-asset USD volume. `build_metric_observations` adds a deterministic streaming input SHA-256, input count, bounded ID/endpoint samples, and provider/collection/calculation timestamps; the full per-fetch payloads and endpoint URLs remain in `normalized_record_observations`. Only if explicitly requested does `--derive-observed-metrics` store these as **observed samples**, not complete-day network totals; missing signer or provenance data yields no corresponding metric. The reproducible PostgreSQL examples are in [`sql/postgres-daily-activity.sql`](../sql/postgres-daily-activity.sql). Query comments explicitly label observed rows versus complete-day history and top-level function calls versus receipt-level contract activity.

PostgreSQL persistence is implemented but **not active**: there is no `NEAR_SIGNAL_DATABASE_URL`, PostgreSQL client/driver, or authorized database in this environment. No external database was created, the DDL was not applied, and no record is claimed to have been persisted. Credentials remain server-side; the static app receives none.

## Run and test

The dependency-free normalization and calculations can be tested with:

```bash
npm run test:ingestion
```

A one-shot live Neardata read that does not write to a database is:

```bash
npm run ingest:near
```

The command lists sources without network calls using `npm run ingest:near -- --list-sources`; it can also fetch `--first-available` or one `--height N`. Only after a database is authorized and configured should an operator install `ingestion/requirements.txt` and explicitly use `npm run ingest:near -- --persist --initialize-schema` (first run) or `--persist` (subsequent runs). Add `--derive-observed-metrics` only when observed-sample counts are wanted; they are not complete-day totals.

An operator-triggered bounded historical range is available after PostgreSQL setup:

```bash
npm run backfill:neardata -- --from-height 224536569 --to-height 224536570 --initialize-schema
```

This example ingests only the two selected heights. The default invocation caps ranges at 100 blocks and waits five seconds between requests; no provider numeric quota was published, so confirm terms/limits before larger use. `--initialize-schema` is for the first run, `--max-blocks` can be raised up to 10,000 per invocation, and ranges must be split if larger. A failed height aborts the range after recording the failed run; previous blocks stay committed and can be safely re-run. The command does not certify gapless archive coverage and was not run here.

A BigQuery dry-run command is available only after Google ADC and an authorized project are configured:

```bash
npm run bigquery:dry-run -- --start-date 2026-11-01 --end-date 2026-11-08 --contract-account-id example.near
```

This submits a dry run only; it does not execute the query or return data. Unavailable providers stay disabled in [`ingestion/catalog.py`](../ingestion/catalog.py) until their access conditions have actually been met.
