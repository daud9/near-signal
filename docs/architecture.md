# Architecture

NEAR SIGNAL is a static browser-rendered application using JavaScript ES modules and no third-party runtime dependencies. The existing Vercel project serves the static page; `server.mjs` remains a loopback-only local development server. There is no server-side data proxy, account service, database, wallet connection, or transaction-signing path.

## Data and query flow

`src/data.js` owns connected source metadata, direct read-only HTTP/JSON-RPC requests, timeouts, parsing, validation, timestamps and source errors. The browser reads FastNear mainnet RPC, CoinGecko and DefiLlama. It does not embed API keys or query BigQuery/NEAR Intents.

For a finalized block, the app requests every referenced shard chunk and displays a transaction total only when each response matches the block's referenced shard ID, hash and inclusion height and contains a transaction array. Transaction identities and receipts are discarded. The current validator set and node status are point-in-time provider observations.

`src/analytics.js` contains deterministic calculations for exact-date market/TVL matching, window changes, daily descriptive correlations, block/validator metrics and scoped risk states. Missing dates/fields remain unavailable. `src/app.js` renders the five dashboard modules, live status, chart/table and each chart's query/derivation disclosure.

`src/query-registry.js` is the source of truth for the documented BigQuery sample and chart source recipes. `scripts/export-queries.mjs` writes the checked-in `sql/near-signal.sql` from that definition. The BigQuery query template has `block_date` filters on each scanned relation, uses `receipt_actions.signer_account_id` for receipt signer attribution, and is not executed. The authenticated schema inspection confirmed `receipt_origin_transaction`; its dated inventory and fields are recorded in [`bigquery-live-schema.md`](bigquery-live-schema.md).

`scripts/rebuild-data.mjs` fetches only currently connected public sources and builds a dated evidence bundle containing raw responses, aligned chart inputs, query recipes, calculations and disconnected-source states. `npm run rebuild` runs the SQL export and evidence refresh; `npm run replay` reconstructs charts from the saved raw block, minimal matched-chunk evidence and transaction hashes without network access. Neither command runs BigQuery or NEAR Intents. Thus the app reproduces connected-source chart inputs, not the unavailable daily-account/contract/Intents histories or a historical archive of browser observations.

## Refresh and access choices

The finalized block refreshes about once a minute. All-shard sampling is limited to once per five minutes. RPC status and validators refresh every five minutes, DefiLlama spot every two minutes and TVL about every 30 minutes. CoinGecko history/snapshot loads on page start or manual refresh, with a cooldown. Requests are deduplicated; errors use capped backoff. FastNear's free-tier numeric request limit is unpublished, so the app avoids tight polling and historical backfill.

The BigQuery dataset query requires Google Cloud access and may incur query-processing charges. The schema UI was inspected, but the app still has no server credentials, project, or budget configuration, and no query or dry-run was submitted. The Intents Explorer requires a Partner Dashboard JWT and is rate limited; a static browser should never contain that token. No server-side secret store or proxy exists, so both integrations remain visibly unavailable.

## Security and privacy

The static app only calls its configured public feeds. The loopback server sets restrictive headers. No provider credentials, secret values, user accounts or wallet data are stored in the repository or sent from the app. Browser-local block observations are not uploaded. Git ignores local `.env` files. The app performs no state-changing transaction.

## Verification

`npm run check` validates JavaScript syntax. `npm test` runs **24** deterministic analytics, data, content, import-safety, local-server and query-registry checks. `npm run rebuild` regenerates the query file and connected-source snapshot. The post-change browser and Vercel deployment checks are recorded in [implementation status](implementation-status.md).

## Not implemented

There is no daily account/transaction-history feed, account cohort/retention calculation, historical contract series, reconciled NEAR Intents/bridge flow, long-run fee/reward accounting, multi-epoch validator history, multi-provider uptime monitor, full app/dependency risk inventory or overall NEAR Ecosystem Health Score. No unavailable metric is filled with a proxy or a mock value.

## Routed workspace

`src/workspace.css` defines the sidebar shell and responsive mobile drawer. `src/workspace.js` owns route metadata, validated local SQL generation, execution-cost arithmetic and CSV serialization. The application controller shows one existing module at a time from a hash route, preserving direct links and browser history. No client-side route starts a warehouse job or sends a JWT.

The on-demand account inspector shares the public RPC adapter but is not a scheduled feed. It records its request, returned account state and fetch time separately from the eight automatic feeds. User exports include its last successful snapshot, calculator inputs and selected chart windows. The Playwright suite in `e2e/` uses real read-only endpoints rather than mock UI data.
