# Alternative NEAR data infrastructure

## What works now

NEAR SIGNAL has a browser-based read-only path for live market/TVL sources and an exact-height FastNEAR Neardata block/shard bundle for its one-block sample. Separately, the repository contains an optional Python CLI for Neardata reads, a block-only FastNEAR public RPC fallback, normalized records, PostgreSQL DDL/persistence code, source-scoped calculations and reproducible PostgreSQL examples. The static dashboard does not use the optional database track and has no provider keys or database connection.

A prior live Neardata read returned HTTP 200 after following the documented `/v0/last_block/final` redirect. The adapter validated all 10 shard chunk hashes and inclusion heights before accepting 15 transaction rows (sample block 224,536,570, observed 14 November 2026). A live `/v0/first_block` request resolved to height 9,820,210. These checks show those endpoints and records were accessible at that time; they do not prove gapless archival history, completeness across every block or a numeric request quota.

A later production-page check found one shard reference whose inclusion height was the previous block and no new chunk payload. That reused chunk contributes zero transactions for the sampled block; its old transactions must not be counted again. The browser and optional Python adapter validate new chunks, handle earlier-height references as zero, and retain regression tests for those cases and duplicate-shard rejection.

If Neardata's latest-block read fails, the optional CLI can fetch one finalized block from the already-used public RPC. This fallback is explicitly block-only: it does not create transaction history, daily activity or adoption metrics.

## Provider access checks

The checks below were read-only. “Reachable” means a host or documentation responded; it does not mean that an account, API scope or historical coverage is authorized or complete.

| Provider | Access check | Authentication, limits and history | Decision |
|---|---|---|---|
| [NearBlocks API](https://api.nearblocks.io/api-docs) | Official API documentation and [Terms](https://nearblocks.io/terms) were reachable. No data API endpoint was called because the Terms bar automated collection and third-party applications without prior written consent. | Docs describe a Bearer API key after plan activation. Published Free tier: 10 calls/minute, 420/day and 12,500/month. No earliest-history floor or completeness guarantee was found. | Do not use until written permission and an authorized plan/key are in place. |
| [Pikespeak API](https://api.pikespeak.ai/docs) | Docs and OpenAPI were reachable. The protected data endpoint was not called because it requires an `x-api-key` that is not configured. | Plans publish a limited free tier and higher paid plans. Some endpoints support cursors; no general earliest-history floor or completeness SLA was found. | Not connected; do not add a key-gated feed as if it were available. |
| [FastNEAR indexed API](https://docs.fastnear.com/api) | `GET https://api.fastnear.com/status` returned HTTP 200. This is a status endpoint, not a test of indexed account/asset data. | Indexed-data docs require an API key. The account-transaction API documents block-height filters and paginated cursors; no global retention floor was found. | Not connected. Neardata's public block cursor is not unrestricted indexed-history access. |
| [FastNEAR Neardata](https://docs.fastnear.com/neardata) | Latest-block and explicit-block requests returned documented block/shard data; the adapter validated the sample. | No key was required for tested block cursors. No numeric rate limit or gapless archive guarantee was found in reviewed docs. | Used for current exact-height samples and optional operator-triggered bounded reads. Backfill is sequential, defaults to 100 heights with a five-second delay, and never runs automatically. |
| [Intear Events API](https://docs.intear.tech/docs/events-api/) | The documented WebSocket hostname failed DNS resolution before a handshake. A separate schema endpoint responded, but that is a different service. | Docs describe real-time events but no verified historical replay, cursor, retention floor or numeric Events-host quota. | Not connected; validate host access, terms and authentication before implementing. |
| [NEAR Intents Explorer](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) | An unauthenticated read-only transaction request reached the host and returned HTTP 400 with an empty body. This is reachability, not authorized data access. | Partner JWT required. Docs describe one request every five seconds and up to 1,000 records per page. Cursor filters cover historical 1Click swaps only; no general history floor or completeness guarantee is documented. | Not connected until authorized partner access and a validated response exist. Do not label this all Intents activity or net flow. |

Published limits are provider documentation, not load tests. Read the [Pikespeak plans](https://pikespeak.ai/plans), [FastNEAR auth](https://docs.fastnear.com/auth), [FastNEAR transaction API](https://docs.fastnear.com/tx), [Intear schema](https://api.intea.rs/schema), and [Intents transaction docs](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/transactions) before any future integration.

## Storage, lineage and reproducibility

The optional PostgreSQL schema in [`sql/postgres-schema.sql`](../sql/postgres-schema.sql) tracks provider identity, request status, payload hashes, normalized records and source-record/run observations. Metric observations record non-null numeric values, source/period, provider/collection/calculation times, input count/hash, method version and dimensions.

The shared normalizer rejects missing/non-finite metric values rather than converting them to zero. Python calculations aggregate only supplied records, keep providers separate, do not fill missing dates, do not identify signer addresses as people, and do not report Intents net flow or cross-asset USD volume. `build_metric_observations` adds a deterministic input hash and provenance. Explicit `--derive-observed-metrics` stores **observed samples**, not complete-day network totals. Reproducible PostgreSQL examples are in [`sql/postgres-daily-activity.sql`](../sql/postgres-daily-activity.sql).

PostgreSQL persistence is implemented but **not active**: there is no `NEAR_SIGNAL_DATABASE_URL`, PostgreSQL driver or authorized database configured. No external database was created, the DDL was not applied, and no record is claimed to have been persisted. The static web app does not read or write this backend.

## Run and test

Offline normalization and calculations:

```bash
npm run test:ingestion
```

One Neardata read without database writes:

```bash
npm run ingest:near
```

List sources without network calls using `npm run ingest:near -- --list-sources`; fetch a first-available block or one explicit height using `--first-available` or `--height N`. PostgreSQL persistence requires an authorized database, local driver setup and explicit `--persist`; first-time schema setup additionally requires `--initialize-schema`. Add `--derive-observed-metrics` only when observed-sample counts are wanted; they are not complete-day totals.

An operator-triggered bounded historical range is available only after PostgreSQL setup:

```bash
npm run backfill:neardata -- --from-height 224536569 --to-height 224536570 --initialize-schema
```

This example requests only the two selected heights. The default invocation caps ranges at 100 blocks and waits five seconds between requests; confirm current terms/limits before larger use. `--initialize-schema` is for the first run, and `--max-blocks` can be raised up to 10,000 per invocation. A failed height aborts the range after recording the failed run; previous blocks stay committed and can be rerun. The command does not certify gapless archive coverage and has not been run against an external database.
