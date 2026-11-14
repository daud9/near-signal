# Data-source inventory

NEAR SIGNAL currently uses eight read-only feeds and lists five disconnected candidates. “Not connected” means the app makes no request. A successful provider response is not an SLA or permission to exceed that provider's terms.

## Connected feeds

| Source | Data used | Cadence | Important limit |
|---|---|---|---|
| FastNEAR public NEAR mainnet RPC | Finalized block/chunk gas, node status and current validator set | Block about once a minute; status/validators every five minutes | Public-provider point-in-time view only. NEAR lists the free-tier request limit as unpublished. One block is not a network-wide health guarantee. |
| FastNEAR Neardata | Exact-height finalized block's all-shard transaction sample, read at the RPC block height | One bundle request at most every five minutes while the page is open | Every newly included chunk must match; a shard reference with an earlier inclusion height contributes zero for this block and needs no old chunk payload. No numeric request quota or gapless archive guarantee is published. One block is not daily activity, unique users or an adoption trend. |
| CoinGecko market snapshot | Timestamped NEAR spot price, market cap, gross 24-hour exchange volume and change | On page load or user refresh | Keyless access is intended for testing/open-source/education and is dynamically rate-limited. Gross volume is not on-chain flow. |
| CoinGecko daily market history | Daily price, market-cap and gross-volume observations | On load or user refresh | External market context, not network activity. The partial current UTC date is excluded. |
| DefiLlama spot price | Independently timestamped price check | About every two minutes while the page is open | Cross-check only; not an executable quote or on-chain oracle. |
| DefiLlama NEAR TVL | Dated daily USD TVL stock | About every 30 minutes while the page is open | Asset stock, not deposits, net inflow, retention or protocol revenue. |

The latest per-feed status and timestamps are in the dashboard and evidence snapshot. These public services may change access, caches, limits or terms.

## BigQuery: documented, not connected

The authenticated Google Cloud console displayed all 16 objects in `bigquery-public-data.crypto_near_mainnet_us` on 14 November 2026: `account_changes`, `accounts` (view), `blocks`, `chunks`, `circulating_supply`, `execution_outcomes`, `ft_balances_daily`, `ft_events`, `ft_events_contracts_by_account` (materialized view), `nft_events`, `nft_events_contracts_by_account` (materialized view), `receipt_actions`, `receipt_details`, `receipt_origin_transaction`, `transaction_actions`, and `transactions`. No objects named `receipt_origin` or `receipts` appeared. See [`bigquery-live-schema.md`](bigquery-live-schema.md) for the dated inspection and field notes.

The inspected `transactions`, `receipt_actions`, and `receipt_origin_transaction` tables are partitioned on nullable `block_date` DATE fields. The schema UI inspection ran no query, opened no Preview, performed no dry-run, and enabled no billing. The app has no programmatic BigQuery credentials, project, or budget configuration, so BigQuery remains disconnected. Google Cloud may bill query processing; review the bytes estimate and approve spending before using [`sql/near-signal.sql`](../sql/near-signal.sql). All scanned relations in that template filter on `block_date`, and receipt signer attribution uses `receipt_actions.signer_account_id` without a redundant `transactions` join. No SQL result or success claim exists.

The example defines daily active accounts as distinct transaction signer accounts, not people. It counts distinct transaction hashes separately, and isolates contract `FUNCTION_CALL` activity by receiver account. Contract-usage counts are not interchangeable with transactions or receipts.

## NEAR Intents Explorer: documented, not connected

The [Explorer API](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) is read-only and covers historical **1Click Swap** records and statuses. Base URL: `https://explorer.near-intents.org/api/v0`. Every request requires a JWT from the [Partner Dashboard](https://partners.near-intents.org/) as `Authorization: Bearer <JWT>`. The documented partner limit is one request every five seconds; transactions use cursor pagination.

No JWT is configured and the app makes no Explorer request. A static browser bundle must not contain the secret. The API's 1Click scope is not all Intents activity. A future net-flow measure must reconcile the record with finalized `intents.near` settlement and destination/bridge delivery or refunds.

## Other disconnected candidates

| Candidate | Status |
|---|---|
| Pikespeak daily active-account history | API-key-gated; no key or plan configured. Address counts do not prove people, retention or organic use. |
| NearBlocks history | No request is made. Published terms require written consent for third-party apps and prohibit automated collection; prior unauthenticated access did not establish permission. |
| FastNear indexed history | Separate from public RPC; API key required and no authorized query configured. |
| BigQuery history | Live schema inspected in the console; no programmatic app credentials/project, cost-approved query, dry-run, or result. |
| NEAR Intents Explorer | Partner JWT required; no API call or raw response. |

## Collection and quality rules

- Connected sources are fetched directly by the browser; the local server is loopback-only and has no provider proxy or stored credentials.
- A sampled block count is withheld if the block identity/references mismatch or a newly included shard chunk is missing or mismatched. A shard reference with an earlier inclusion height contributes zero transactions to this block. The documented chunk response has no separate `block_hash` field; checks use the documented returned fields.
- Daily market/TVL dates are joined exactly in UTC. Missing dates are not interpolated, and the partial current day is excluded.
- A 7-, 14- or 30-day endpoint change requires 8, 15 or 31 consecutive daily observations.
- Source failures, stale observations and missing data stay visible. Last-good values retain their last successful timestamp.
- The browser export retains a finalized block and only the chunk fields and transaction hashes needed to replay sampled counts. Full transaction bodies and receipt payloads are discarded. The rebuild bundle preserves connected-source provenance and raw chart inputs.

## On-demand account lookup

The Organic Adoption workspace also offers a user-initiated, read-only `view_account` query at `https://free.rpc.fastnear.com`. It returns the selected account’s current finalized balance, locked amount, storage usage, code hash and block identity. The inspector shows the raw request/response and fetch timestamp and includes them in a user-requested evidence export. It is not a scheduled feed or a historical adoption source, so it is separate from the eight automatically checked feeds.


## Separate alternative-ingestion track

The browser app now reads an exact-height Neardata shard bundle directly for its sampled per-block transaction count; the new Python ingestion/storage track remains separate and optional. Actual reachability, authentication, documented limits, historical coverage, and terms for NearBlocks, Pikespeak, FastNEAR indexed data, Neardata, Intear Events, NEAR Intents and BigQuery are documented in [`alternative-data-infrastructure.md`](alternative-data-infrastructure.md). In brief: Neardata's latest/first block cursors and sample shard data were reachable; NearBlocks remains blocked pending written permission; credential-gated providers remain disabled; Intear Events DNS failed before handshake; and BigQuery requires an authenticated execution project.

The PostgreSQL adapter and schema are local/testable only. No database URL or ADC/project is configured, no external database was created, and the schema was not applied. The browser's Neardata request uses no API key or JWT; it is independent of the optional persistent ingestion path.
