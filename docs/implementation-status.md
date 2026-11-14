# Implementation status

Updated **14 November 2026** after a performance and reliability pass on the existing NEAR SIGNAL app.

## Implemented

- Six routed workspaces: Overview, Thesis Challenge Engine, Ecosystem Risk Radar, Value Capture Lab, Network Activity & Validators, and Liquidity & TVL Context. Thesis and Risk are promoted directly after Overview.
- Eight live, read-only feeds from FastNEAR RPC/Neardata, CoinGecko and DefiLlama; no credential-gated or disconnected candidate appears as a live feed.
- Source timestamps, request statuses and source-specific freshness thresholds. Daily market/TVL observations older than 48 hours are marked stale; retained values after a failed refresh are labeled. Malformed CoinGecko/TVL payloads are rejected rather than accepted as healthy data.
- Chunk validation for the exact finalized block, including prior-height references as zero and fail-closed handling of missing, mismatched or duplicated shard data.
- Chart query/derivation disclosures, CSV export, thesis evidence export, account lookup and execution-budget calculator. No standalone SQL-generator panel remains.
- One supported rebuild path: `npm run rebuild` refreshes connected public feeds and creates offline replay inputs; `npm run replay` reproduces charts from a saved evidence file without network access.
- `THESIS.md` retains the falsifiable claim, dated evidence for and against it, change-of-view criteria, reproducibility instructions and limitations.

## Verification

- `npm run rebuild` completed from **8/8 connected feeds**, with 0 failures, 31 matched market/TVL dates, finalized block 224,553,669, a complete five-transaction sample, and 355 current validator records. Offline replay completed.
- `npm run check` passed; `npm test` passed **46/46** deterministic JavaScript tests.
- `npm run test:ingestion` passed **30** Python tests; one optional live RPC check was skipped by default.
- `npm run test:e2e` passed **4/4** browser checks, including live account lookup, chart/test/evidence exports, desktop/mobile navigation, stale-history labeling, and simulated provider-failure handling.
- One local Chromium timing run reached the page shell in **152 ms**, matched chart data in **2.21 s**, and a finalized block in **2.68 s**, with no browser errors. Public-feed latency varies by run.

## Unavailable and intentionally not claimed

- Daily account cohorts, historical transaction/contract activity, retention, full fee/reward accounting, authenticated Intents history, reconciled bridge/Intents flows, multi-epoch validator history, multi-provider uptime and an overall ecosystem health score are not available.
- The one-block sample is not a daily trend, user count or archive. Market volume is exchange turnover; TVL is an asset stock. No unavailable value is filled with a placeholder.
- The optional Python/PostgreSQL ingestion code is separate from the static web app and remains unconfigured; no external database is used or created.

The only public destination used is the existing Vercel deployment. No hackathon submission, separate profile or public post has been made.
