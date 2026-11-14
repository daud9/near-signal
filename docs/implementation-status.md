# Implementation status

Updated **14 November 2026** during the NEAR AI Investment Thesis track alignment.

## Implemented

- Five dashboard modules: **Value Capture Lab**, **Ecosystem Risk Radar**, **Organic Adoption Intelligence**, **Capital Flow Intelligence**, and **Thesis Challenge Engine**.
- Live read-only sources include FastNEAR public mainnet RPC, FastNEAR Neardata, CoinGecko and DefiLlama. The browser requests Neardata's exact-height block/shard bundle at most every five minutes for a finalized-block transaction sample; it needs no API key or new server/database. The existing Vercel project is the deployment target; changes are scoped to its current app/repository.
- Each current chart exposes its source request or SQL, derivation/validation rule, and a plain-language sentence. Query disclosures remain visible when there are no plotted points and preserve their open state during refresh.
- The authenticated Google Cloud console displayed the complete 16-object BigQuery inventory, including `receipt_origin_transaction` and no `receipt_origin` or `receipts` object. The inspected `transactions`, `receipt_actions`, and `receipt_origin_transaction` tables are partitioned on `block_date` DATE. The daily signer/transaction/contract-use SQL template is visible in the dashboard and checked in as `sql/near-signal.sql`; every scanned relation has a `block_date` range filter.
- Intents Explorer requirements are visible in the dashboard: 1Click-only scope, JWT as a Bearer token, cursor pagination, and one request every five seconds per partner. No token is embedded or request made.
- `npm run rebuild` regenerates SQL from the shared query registry and writes a dated evidence snapshot including raw connected-source inputs, aligned chart inputs, chart query recipes and disconnected-source status.
- `THESIS.md` now contains the working hypothesis, timestamped evidence for/against it, what would change the view, and the data and access limitations.

- Desktop sidebar and mobile drawer route to focused module workspaces, preserving deep links and browser history.
- Working tools include a live read-only account/contract inspector, execution-budget calculator, local date/contract SQL builder, chart-window selection, risk filters, chart CSV/copy-query controls, and sourced thesis-result export. All require actual inputs; unsourced analytical metrics remain unavailable.

## Verification performed

- `npm run check` passed JavaScript syntax validation.
- `npm test` passed **37** deterministic tests, including Neardata current-height chunk validation, prior-height zero-contribution references, offline replay, query disclosure requirements, calculations and local-server security.
- `npm run test:ingestion` passed **30** Python tests (one opt-in live RPC test is skipped by default). The desktop/mobile Playwright suite passed **2/2** against the local app and verified the responding Neardata feed and rendered new-chunk count; production-origin CORS and the deployed module were checked.
- The SQL artifact was generated from the same query definition used by the dashboard. No BigQuery query or dry run was submitted. One unauthenticated Intents Explorer reachability check returned HTTP 400; no authorized data request or token was made.
- The previous track-aligned commit was verified byte-for-byte at the existing production URL. The sidebar follow-up passed live desktop/mobile browser tests: all seven routes, account inspection, fee calculation, risk filters, chart/SQL/test/evidence downloads and selected-window replay. Those tests made no BigQuery query or authorized Intents data request.

## Unavailable and intentionally not claimed

- The schema inspection used the authenticated console UI only and is recorded in [`bigquery-live-schema.md`](bigquery-live-schema.md). It opened no Preview, ran no query, performed no dry-run, and enabled no billing. The app's programmatic BigQuery integration remains disconnected: no server credentials, project, or budget is configured.
- BigQuery query processing may be billable. The template has not been run or tested against returned data; no metrics are filled in meanwhile. It uses `receipt_actions.signer_account_id` for receipt signer attribution and does not add a redundant `transactions` join.
- NEAR Intents Explorer needs a Partner Dashboard JWT and covers 1Click swaps only. No JWT was supplied, and no server-side integration exists.
- Daily signer-account history, retention, historical contract activity, Intents volume or reconciled net flow, historical fee/reward accounting, long browser-block history, multi-provider uptime, and complete application/bridge risk history are unavailable.
- The official one-command goal to rebuild **every intended chart** from raw data is only met for currently connected inputs. Browser observations retain the raw finalized block plus chunk verification fields and transaction hashes; they discard transaction bodies and receipt payloads. `npm run replay` reconstructs charts from saved evidence without network access; `npm run rebuild` refreshes connected sources before replay. BigQuery/Intents metrics and a historical chain archive cannot be reproduced until their inputs are available.

No hackathon submission, new profile, or public post has been made. This update does not create additional public content beyond the user-authorized existing application and its deployment.


## Alternative data infrastructure — 14 November 2026

- Live tests: Neardata `/v0/last_block/final` and `/v0/first_block` returned HTTP 200 after documented redirects. The latest sample resolved to block 224,536,570 with 10/10 shard chunk references matched and 15 transaction rows; the first cursor resolved to block 9,820,210. These point observations do not prove a gapless archive or a completeness SLA. The FastNEAR public JSON-RPC fallback adapter also passed a live read-only finalized-block smoke test; it remains block-only.
- Provider review: NearBlocks data API was not called because its fetched Terms prohibit automated extraction and third-party applications absent written consent. Pikespeak documentation/OpenAPI were reachable but the protected data endpoint was not called because no `x-api-key` is configured. FastNEAR indexed status was reachable, but indexed data requires an API key. The Intear Events hostname failed DNS before handshake; a separate Intear API schema endpoint returned HTTP 200, which does not verify Events access. The Intents Explorer returned HTTP 400 without a JWT; this is endpoint reachability, not authorized data access. BigQuery metadata-only unauthenticated access returned HTTP 401.
- Implemented: source access catalog; normalized block/transaction model plus per-run payload observations; bounded operator-triggered Neardata height backfill (100-height default, sequential 5-second minimum); optional PostgreSQL persistence; source-scoped Python calculations and versioned metric provenance; parameterized PostgreSQL queries; and BigQuery ADC adapter restricted to dry runs (`configuration.dryRun=true`). Derived metrics are disabled by default and do not fill missing days or signer counts.
- Verified: `npm run test:ingestion` runs 30 deterministic Python checks successfully; the opt-in live FastNEAR fallback smoke test is skipped by default and was separately run successfully once. The application and protocol-edge-case update passed `npm test` (37 tests), `npm run check`, and `git diff --check`.
- Prepared but not connected: `.github/workflows/near-ingestion.yml` is manual-only, serialized, limited to one Neardata latest/height fetch per run, and times out after five minutes. It uses a future `NEAR_SIGNAL_DATABASE_URL` repository secret and a fail-closed 800 MiB connected-database storage stop. No schedule, paid plan change, Neon API token, account, database, credential, or workflow run was created. Details and current Neon Free limits are in [`neon-github-actions.md`](neon-github-actions.md).
- Not connected: no PostgreSQL URL/driver or ADC/project is available. The PostgreSQL DDL was not applied; no external records were persisted, and the explicit backfill was not run. No BigQuery query or dry run was submitted. The browser's Neardata read is active for one exact finalized-block sample; the separate optional CLI/database track remains unconfigured. Gated sources and unavailable historical metrics remain disabled/unavailable.

See [`alternative-data-infrastructure.md`](alternative-data-infrastructure.md) for exact endpoints, access tests, rate limits, history caveats, setup commands and official source links.
