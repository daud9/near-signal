# NEAR SIGNAL — submission package (draft; not submitted)

## Project description (draft)

**NEAR SIGNAL** is a read-only NEAR ecosystem analysis dashboard that separates live mainnet observations from market context and from data the prototype cannot yet measure. It verifies a transaction count across every shard chunk in a sampled finalized block, reads the current RPC-reported validator set, and aligns timestamped market data with daily DeFi TVL. It exposes sources, timestamps, calculations and caveats; it does not turn one block into a daily user trend or TVL into net capital flow. The overall NEAR Ecosystem Health Score is withheld when evidence is incomplete. NEAR SIGNAL is a research prototype, not investment advice.

## Problem and approach

Public ecosystem charts often mix on-chain activity, market metrics and liquidity stocks even though they have different meanings and update schedules. NEAR SIGNAL presents each signal with its own source time and scope. It uses a public mainnet RPC and public market/TVL feeds, tests complete shard counts before displaying them, aligns dated series before calculating changes, and labels missing account, retention and flow evidence instead of inventing it.

Its distinction is the evidence policy and end-to-end inspectability—not a claim that the raw metrics are unique. The selected correlation test is deterministic and limited to the user-selected daily price, TVL or gross market-volume series. A threshold crossing is an investigation prompt, not a risk or security finding.

## Verified features to demonstrate

1. Live finalized block height and provider freshness from FastNear’s public free RPC endpoint.
2. Complete all-shard transaction count for one sampled finalized block; each chunk must match its referenced hash, shard and inclusion height.
3. Current active-set validator count, top-ten stake share, HHI and returned epoch counters, clearly marked as a single current snapshot.
4. Timestamped CoinGecko market fields, a separate DefiLlama spot check, and daily DefiLlama TVL.
5. Exact-date matched charts, accessible observation tables, and complete 7/14/30-day endpoint changes.
6. Six evidence-scoped risk cards and a 5–50% threshold that applies only to the configured 24-hour price and 30-day TVL declines.
7. A selectable Pearson-correlation test, JSON evidence export, and one-command dated snapshot rebuild.

## Explicitly not implemented

Daily account history, unique people, cohort retention, a daily transaction trend, complete contract/application concentration, reconciled bridge or Intents net flows, long-term validator history, a network-wide uptime/security score, the overall NEHS, a hosted demo, a public repository, and published submission materials are not available/complete. No disconnected provider is queried. Do not claim those features in a pitch or post.

## Technical architecture and reproducibility

Static HTML/CSS and JavaScript ES modules. `src/data.js` performs read-only source requests, `src/analytics.js` contains testable calculations, `src/app.js` renders the interface, `server.mjs` serves only on loopback, and `scripts/rebuild-data.mjs` writes `data/latest-evidence.json`.

```bash
npm test
npm run check
npm run rebuild
npm run dev
```

Open `http://127.0.0.1:8000`. The app requires browser internet access to its listed public sources. There are no third-party runtime dependencies or embedded API keys. `npm test` currently passes 21 tests. The local Chromium check verified all eight connected feeds, the current validator set, all-shard block counting, controls and JSON export; no console/page errors or page-wide mobile overflow were reported. See [architecture](architecture.md), [methodology](methodology.md), and [source notes](data-sources.md).

## Short demo outline

1. Open the dashboard and wait until the feed header says all eight connected feeds respond.
2. Show a finalized block, its age, and the gas estimate. Explain why it is not revenue.
3. Open Participation: show the current active validator set and a complete all-shard transaction count; explicitly say one block is not users, adoption, or a daily trend.
4. Compare the 7-, 14- and 30-day market/TVL context and open its data table. Distinguish TVL stock and gross market volume from net capital flow.
5. Show the risk cards and change the threshold. Note that the price/TVL crossing is a prompt, not a security finding.
6. Run a selectable hypothesis test and explain that correlation is descriptive, not causal or predictive.
7. Open Method & Data, show disconnected account/retention/flow sources and why NEHS is withheld, then export JSON.
8. Close by stating that the app is a local read-only prototype; do not imply a public repo, deployment or submission.

The latest local screenshots and silent walkthrough are in [`screenshots/`](../screenshots/). The video is a demo artifact, not a deployed app.

## Suggested X post (draft only; not posted)

> Built for NEAR: NEAR SIGNAL — a read-only research dashboard separating live finalized-block activity, current validator data, market context and DeFi TVL. It checks all referenced shard chunks, shows what remains unmeasured, and withholds an ecosystem-health score when evidence is missing. Local demo and source-backed methodology; not investment advice. #NEAR

Do not post this or imply a hosted demo/public repository exists without explicit approval and a verified public URL.

## Official requirements and remaining fields

The checked [NEAR Hackathon rules](https://nearhackathon.com/HACKATHON.md) specify a deadline of **14 November 2026 at 23:59 UTC** (15 November at 00:59 WAT). Required information includes public repository and public X post URLs, project name, team lead, email, team size, selected track(s), NEAR account address and a 20–2,000-character description. Investment Thesis guidance asks for an evidence-first `THESIS.md`, reproducible README steps and a one-command chart/data rebuild. Mainnet transactions are not required; read-only sourced mainnet analysis is suitable.

## Release checklist

- [x] Local live-data app with a dated source registry and explicit unavailable states.
- [x] Reproducible `npm run rebuild`, `THESIS.md`, methodology, source and competitor notes, screenshots, demo video and tests.
- [x] 21 deterministic tests and a local browser interaction/mobile check pass.
- [ ] Reconfirm public-use terms and provider availability before any public deployment.
- [ ] Obtain explicit approval to publish this changed project or its X post; approval remains pending.
- [ ] Confirm the team lead, contact email, team size, track(s) and NEAR account address.
- [ ] Create/verify the public repository and required X post; neither exists yet. Current GitHub path cannot create a repository.
- [ ] Submit only after the exact public URLs and required fields are available and the user approves.

**Current readiness:** the in-scope local MVP is implemented and browser-verified. It is not publicly deployed or submitted. Daily account/retention history and reconciled capital-flow features remain unconnected for documented access/scope reasons; do not describe them as functional. Public release/submission is not authorized.
