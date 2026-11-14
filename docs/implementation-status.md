# Implementation status

Updated **14 November 2026** during the NEAR AI Investment Thesis track alignment.

## Implemented

- Five dashboard modules: **Value Capture Lab**, **Ecosystem Risk Radar**, **Organic Adoption Intelligence**, **Capital Flow Intelligence**, and **Thesis Challenge Engine**.
- Existing live read-only sources remain FastNear public mainnet RPC, CoinGecko and DefiLlama. The existing Vercel project is the deployment target; changes are scoped to its current app/repository.
- Each current chart exposes its source request or SQL, derivation/validation rule, and a plain-language sentence. Query disclosures remain visible when there are no plotted points and preserve their open state during refresh.
- The authenticated Google Cloud console displayed the complete 16-object BigQuery inventory, including `receipt_origin_transaction` and no `receipt_origin` or `receipts` object. The inspected `transactions`, `receipt_actions`, and `receipt_origin_transaction` tables are partitioned on `block_date` DATE. The daily signer/transaction/contract-use SQL template is visible in the dashboard and checked in as `sql/near-signal.sql`; every scanned relation has a `block_date` range filter.
- Intents Explorer requirements are visible in the dashboard: 1Click-only scope, JWT as a Bearer token, cursor pagination, and one request every five seconds per partner. No token is embedded or request made.
- `npm run rebuild` regenerates SQL from the shared query registry and writes a dated evidence snapshot including raw connected-source inputs, aligned chart inputs, chart query recipes and disconnected-source status.
- `THESIS.md` now contains the working hypothesis, timestamped evidence for/against it, what would change the view, and the data and access limitations.

## Verification performed

- `npm run check` passed JavaScript syntax validation.
- `npm test` passed **24** deterministic tests, including `block_date` filter checks, query disclosure requirements, calculations and local-server security.
- The SQL artifact was generated from the same query definition used by the dashboard. No BigQuery query was run, and no NEAR Intents request was made.
- Final local/production browser checks and Vercel deployment confirmation are still pending for this change set.

## Unavailable and intentionally not claimed

- The schema inspection used the authenticated console UI only and is recorded in [`bigquery-live-schema.md`](bigquery-live-schema.md). It opened no Preview, ran no query, performed no dry-run, and enabled no billing. The app's programmatic BigQuery integration remains disconnected: no server credentials, project, or budget is configured.
- BigQuery query processing may be billable. The template has not been run or tested against returned data; no metrics are filled in meanwhile. It uses `receipt_actions.signer_account_id` for receipt signer attribution and does not add a redundant `transactions` join.
- NEAR Intents Explorer needs a Partner Dashboard JWT and covers 1Click swaps only. No JWT was supplied, and no server-side integration exists.
- Daily signer-account history, retention, historical contract activity, Intents volume or reconciled net flow, historical fee/reward accounting, long browser-block history, multi-provider uptime, and complete application/bridge risk history are unavailable.
- The official one-command goal to rebuild **every intended chart** from raw data is only met for currently connected inputs. Browser observations retain the raw finalized block plus chunk verification fields and transaction hashes; they discard transaction bodies and receipt payloads. `npm run replay` reconstructs charts from saved evidence without network access; `npm run rebuild` refreshes connected sources before replay. BigQuery/Intents metrics and a historical chain archive cannot be reproduced until their inputs are available.

No hackathon submission, new profile, or public post has been made. This update does not create additional public content beyond the user-authorized existing application and its deployment.
