# Implementation status

Updated **14 November 2026** after adding the locally validated NEAR Ecosystem Flight Recorder.

## Implemented

- Seven routed workspaces: Overview, Thesis Challenge Engine, Ecosystem Risk Radar, NEAR Ecosystem Flight Recorder, Value Capture Lab, Network Activity & Validators, and Liquidity & TVL Context. Thesis and Risk are promoted directly after Overview; Flight Recorder has a direct overview shortcut.
- Fourteen live, read-only feeds from FastNEAR RPC/Neardata, CoinGecko, DefiLlama and GeckoTerminal; no credential-gated or disconnected candidate appears as a live feed.
- Source timestamps, request statuses and source-specific freshness thresholds. Daily market/TVL observations older than 48 hours are marked stale; retained values after a failed refresh are labeled. Malformed CoinGecko/TVL payloads are rejected rather than accepted as healthy data.
- Chunk validation for the exact finalized block, including prior-height references as zero and fail-closed handling of missing, mismatched or duplicated shard data.
- NEAR Ecosystem Flight Recorder: selectable browser-local finalized block replay, per-shard gas/utilization/verified transaction shares, matched-date weekly DEX-to-TVL turnover intensity, adjacent DEX/fee windows, TVL deltas, filtered protocol concentration, stablecoin quote/circulation context, validator context, source status and a raw-backed JSON/offline replay export. No composite health score or causal finding.
- Chart query/derivation disclosures, CSV export, thesis evidence export, account lookup and execution-budget calculator. No standalone SQL-generator panel remains.
- One supported rebuild path: `npm run rebuild` refreshes connected public feeds and creates offline replay inputs; `npm run replay` reproduces charts from a saved evidence file without network access.
- `THESIS.md` retains the falsifiable claim, dated evidence for and against it, change-of-view criteria, reproducibility instructions and limitations.

## Verification

- `npm run rebuild` completed from **14/14 connected feeds**, with 0 failures, 31 matched market/TVL dates, finalized block 224,574,309, a complete five-transaction sample, and 353 current validator records. Offline replay reconstructed 15 block samples, 14 with exact-height transaction evidence.
- `npm run check` passed; `npm test` passed **60/60** deterministic JavaScript tests, including shard composition, date matching, duplicate-date withholding and bounded source coverage.
- `npm run test:ingestion` passed **30** Python tests; one optional live RPC check was skipped by default.
- `npm run test:e2e` passed **6/6** browser checks, including live-source navigation, fixture-backed Flight Recorder shard visualization and JSON export, mobile layout, live account lookup, stale-history labeling, and simulated provider-failure handling.
- One local Chromium timing run reached the page shell in **152 ms**, matched chart data in **2.21 s**, and a finalized block in **2.68 s**, with no browser errors. Public-feed latency varies by run.

## Unavailable and intentionally not claimed

- Daily account cohorts, historical transaction/contract activity, retention, full fee/reward accounting, authenticated Intents history, reconciled bridge/Intents flows, multi-epoch validator history, multi-provider uptime and an overall ecosystem health score are not available.
- The one-block sample is not a daily trend, user count or archive. Market volume is exchange turnover; TVL is an asset stock. No unavailable value is filled with a placeholder.
- The optional Python/PostgreSQL ingestion code is separate from the static web app and remains unconfigured; no external database is used or created.

The only public destination remains the existing Vercel deployment. This feature change is local only: no commit, push or deployment was made. No hackathon submission, separate profile or public post has been made.
