# Implementation status

Updated **14 November 2026** after the Risk Radar and Thesis Challenge quality pass.

## Implemented

- Seven routed workspaces: Overview, Thesis Challenge Engine, Ecosystem Risk Radar, NEAR Ecosystem Flight Recorder, Value Capture Lab, Network Activity & Validators, and Liquidity & TVL Context. Thesis and Risk are promoted directly after Overview; Flight Recorder has a direct overview shortcut.
- Fifteen live, read-only feeds from FastNEAR RPC/Neardata, CoinGecko, DefiLlama and GeckoTerminal, including dated NEAR aggregate stablecoin circulation; no credential-gated or disconnected candidate appears as a live feed.
- Source timestamps, request statuses and source-specific freshness thresholds. Daily market/TVL observations older than 48 hours are marked stale; retained values after a failed refresh are labeled. Malformed CoinGecko/TVL payloads are rejected rather than accepted as healthy data.
- Chunk validation for the exact finalized block, including prior-height references as zero and fail-closed handling of missing, mismatched or duplicated shard data.
- NEAR Ecosystem Flight Recorder: selectable browser-local finalized block replay, per-shard gas/utilization/verified transaction shares, matched-date weekly DEX-to-TVL turnover intensity, adjacent DEX/fee windows, TVL deltas, filtered protocol concentration, stablecoin quote/circulation context, validator context, source status and a raw-backed JSON/offline replay export. No composite health score or causal finding.
- Chart query/derivation disclosures, CSV export, thesis evidence export, account lookup and execution-budget calculator. No standalone SQL-generator panel remains.
- Thesis Challenge diagnostics: same-sign/opposite-sign counts (zero changes disclosed as ties), leave-one-day-out Pearson range and influence date, exact paired-change export, calculation version, and explicit warnings that these are descriptive rather than significance/robustness tests.
- Risk freshness is applied consistently to the live UI and offline evidence rebuild: a required stale source keeps the finding visible as context but removes its active status. The local server serves only explicit app assets, not evidence files, repository metadata, tests or package files.
- One supported rebuild path: `npm run rebuild` refreshes connected public feeds and creates offline replay inputs; `npm run replay` reproduces charts from a saved evidence file without network access.
- `THESIS.md` retains the falsifiable claim, dated evidence for and against it, change-of-view criteria, reproducibility instructions and limitations.

## Verification

- `npm run rebuild` completed from **15/15 connected feeds** with 0 failures, 31 matched market/TVL dates, finalized block 224,578,269, a complete five-transaction sample and 353 current validator records. Offline replay reconstructed 15 block samples and 14 complete exact-height transaction samples. The source-backed snapshot records three active findings: 30-day ecosystem-TVL drawdown, prior-epoch validator kickouts and USN peg stress; aggregate stablecoin circulation rose 1.78%, below its contraction threshold.
- `npm run check` passed; `npm test` passed **66/66** deterministic JavaScript tests, including paired-change diagnostics, source-freshness rules, stablecoin history, replay and local-server exposure checks.
- `npm run test:ingestion` passed **30/30** Python tests; one optional live RPC check was skipped by default.
- `npm run test:e2e` passed **7/7** desktop/mobile browser checks, including live-source navigation, fixture-backed Risk Radar supply and stale-alert behavior, exact Thesis export diagnostics, Flight Recorder shard visualization/JSON export, account lookup and simulated provider failures.
- In a local Chromium cold run, the app shell reached `DOMContentLoaded` in **183 ms** and all **15/15** browser-side feeds reported success after **14.66 s**. No page errors or failed requests were recorded. This is one observation, not an SLA; external provider latency varies.

## Unavailable and intentionally not claimed

- Daily account cohorts, historical transaction/contract activity, retention, full fee/reward accounting, authenticated Intents history, reconciled bridge/Intents flows, multi-epoch validator history, multi-provider uptime and an overall ecosystem health score are not available.
- The one-block sample is not a daily trend, user count or archive. Market volume is exchange turnover; TVL is an asset stock. No unavailable value is filled with a placeholder.
- The optional Python/PostgreSQL ingestion code is separate from the static web app and remains unconfigured; no external database is used or created.

The only public destination remains the existing Vercel deployment. This release updates that destination only; it does not include a hackathon submission, separate profile or public post.
