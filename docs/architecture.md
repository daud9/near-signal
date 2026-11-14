# Architecture

NEAR SIGNAL is a static browser-rendered application using JavaScript ES modules and no third-party runtime dependencies. The existing Vercel project serves the page; `server.mjs` remains a loopback-only local development server. There is no server-side data proxy, account service, database, wallet connection or transaction-signing path in the deployed dashboard.

## Data and query flow

`src/data.js` owns the eight connected feed definitions, direct read-only HTTP/JSON-RPC requests, timeouts, parsing, validation, timestamps and source errors. The browser reads FastNEAR mainnet RPC and Neardata, CoinGecko, and DefiLlama. The sampled transaction source fetches a Neardata block/shard bundle at the exact finalized RPC height at most once every five minutes; no server proxy, API key or database is required.

For a finalized block, the app requests the Neardata bundle at that exact RPC height and displays a transaction total only when the returned block identity and each new block reference match. Each shard chunk included at this block must match its hash and inclusion height and contain valid transaction hashes. A reference with an earlier inclusion height represents a reused chunk and contributes zero transactions for this block; its old chunk body is not needed or counted again. Missing, duplicated or mismatched newly included chunks withhold the count. Only minimal chunk-match fields and transaction hashes are retained for offline replay; full transaction bodies and receipt payloads are discarded. Current validator and node status are point-in-time observations.

`src/analytics.js` contains deterministic calculations for exact-date market/TVL matching, window changes, descriptive correlations, block/validator metrics and scoped risk states. Missing dates and fields remain unavailable. `src/app.js` renders the routed workspaces, live status, charts/tables and chart source/derivation disclosures. `src/query-registry.js` is the source of truth for active chart and thesis-test recipes.

`scripts/rebuild-data.mjs` fetches only connected public sources and builds a dated evidence bundle containing returned inputs, aligned chart inputs, query recipes, calculations and source statuses. `npm run rebuild` runs the live refresh and offline replay in one supported path. `npm run replay` reconstructs chart inputs from a saved evidence bundle without network access. The rebuild covers connected-source charts, not unavailable daily-account/contract/Intents histories or a historical archive of browser observations.

## Refresh and access choices

The finalized block refreshes about once a minute. Neardata all-shard sampling is limited to one exact-height bundle request every five minutes. RPC status and validators refresh every five minutes, DefiLlama spot every two minutes and TVL about every 30 minutes. CoinGecko history/snapshot loads on page start or manual refresh, with a cooldown. Requests are deduplicated; errors use capped backoff. Source-specific freshness limits mark old provider observations stale.

## Security and privacy

The static app only calls its configured public feeds. The loopback server sets restrictive headers. No provider credentials, secret values, user accounts or wallet data are stored in the repository or sent from the app. Browser-local block observations are not uploaded. Git ignores local `.env` files. The app performs no state-changing transaction.

## Verification and unavailable data

`npm run check` validates JavaScript syntax. `npm test` runs deterministic analytics, data, content, import-safety, local-server and source-recipe tests. `npm run rebuild` refreshes connected feeds and replay inputs. The Playwright suite in `e2e/` exercises the live read-only endpoints.

There is no daily account/transaction-history feed, account cohort/retention calculation, historical contract series, reconciled Intents/bridge flow, long-run fee/reward accounting, multi-epoch validator history, multi-provider uptime monitor, full app/dependency risk inventory or overall NEAR Ecosystem Health Score. No unavailable metric is filled with a proxy or mock value.

## Optional local ingestion backend

`ingestion/` is a separate Python CLI, not a browser proxy or database connection for the Vercel frontend. `providers/neardata.py` reads public Neardata cursors or one explicit block height, validates returned chunk hashes and inclusion heights, and emits compact block/transaction records only when the sample is complete. `providers/fastnear_rpc.py` is a block-only CLI fallback; it does not create transaction history. `backfill_neardata.py` offers an operator-triggered sequential range with a bounded batch cap and conservative pacing; it has no scheduled or automatic mode.

`normalization.py` creates stable record IDs and payload fingerprints. `postgres_store.py` provides an optional persistence adapter against the checked-in schema; persistence, schema initialization and bounded backfill require explicit local setup and operator action. No database URL or external database is configured or used by the browser app. Python calculations do not fill missing dates or interpret addresses as people. See [alternative ingestion notes](alternative-data-infrastructure.md).
