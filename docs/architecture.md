# Architecture

NEAR SIGNAL is a small browser-rendered application with ES modules and no third-party runtime dependencies. The local `server.mjs` binds to loopback only and serves static files with restrictive security headers. There is no public API backend, account service, database, wallet connection, transaction-signing path or hosted deployment.

## Data flow

1. `src/data.js` owns source metadata, request timeouts, parsing, validation, provider timestamps and per-source errors. The browser sends direct read-only requests to FastNear’s public free mainnet RPC, CoinGecko’s keyless endpoints and DefiLlama endpoints. It never embeds an API key.
2. The app fetches a finalized block, then requests every shard chunk referenced by it. The all-shard total is accepted only when every returned chunk matches the documented shard ID, hash and inclusion height and contains a transaction array. Raw transaction records are discarded after counting; only block metadata, chunk hashes, counts and times remain.
3. Separate RPC reads expose current node status and the current active validator set. These are point-in-time provider observations. No historical validator epochs or uptime archive are synthesized.
4. CoinGecko daily market arrays and DefiLlama daily TVL rows are joined on exact UTC dates. `src/analytics.js` contains pure calculation functions for window changes, daily correlations, block/validator metrics and risk states. Missing dates or invalid fields make calculations unavailable rather than filled.
5. `src/app.js` renders source-specific status/freshness, charts and accessible data tables; local controls recalculate risk thresholds and the selected hypothesis. `updateHeader` waits for all eight connected feeds before saying all are responding. Errors retain only last-good values and timestamps.
6. Browser JSON export contains current normalized/source data and browser-local RPC observation history. `scripts/rebuild-data.mjs` performs a reproducible local fetch and writes `data/latest-evidence.json`, including source statuses, calculations, selected raw responses and explicit limits. Neither path retains transaction identities or chunk contents.

## Refresh and access choices

The finalized block is polled about once a minute; all-shard transaction sampling is limited to once per five minutes. RPC status and validators refresh every five minutes, DefiLlama spot every two minutes, and TVL about every 30 minutes. CoinGecko snapshot and history are requested on load/manual refresh, with a manual cooldown. Requests are deduplicated and failures use capped backoff. FastNear’s free-tier numeric request limit is not published, so the product deliberately avoids tight polling and historical backfill.

NEAR’s [official provider list](https://docs.near.org/api/rpc/providers) lists `https://free.rpc.fastnear.com` as a public free-tier endpoint, but archival access is paid-only. It is used only for current/finalized reads. CoinGecko’s [keyless API guidance](https://docs.coingecko.com/docs/keyless-public-api) describes its shared testing/open-source/educational service and attribution needs. Recheck provider terms and availability before any public release.

## Security and privacy

The static server’s CSP allows only the local app and the explicit public feed hosts. There is no API-key proxy or credential. The local browser keeps its own small finalized-block observation history in `localStorage`; it is not uploaded. Exported evidence contains no user account or wallet information. The app performs no state-changing transaction.

## Verification

- `npm test`: 21 deterministic analytics, source, import-safety, content-consistency and static-server tests.
- `npm run check`: syntax validation for application, data, rebuild and test modules.
- `npm run rebuild`: one-command live snapshot; the output labels each connection, timestamp and unavailable source separately.
- Chromium end-to-end check: all eight connected feeds responded; current validator set and complete all-shard sample displayed; chart table, risk controls, selected hypothesis, JSON export and keyboard skip link worked; no console/page/request errors; 390px document width remained within the viewport.

## Not implemented

There is no daily account/transaction-history feed, account cohort/retention measure, full contract/application concentration inventory, reconciled bridge or NEAR Intents net-flow series, multi-epoch validator history, long-run RPC uptime monitor, server-side provider credentials, scheduled alert delivery, public API, hosted demo, public repository or published post. The overall NEAR Ecosystem Health Score is withheld. See the [source inventory](data-sources.md) and [submission draft](submission-package.md).
