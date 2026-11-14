# NEAR SIGNAL

**Live, read-only NEAR signals—with the evidence gaps left visible.**

NEAR SIGNAL is a local research dashboard for observing finalized NEAR mainnet blocks, current validator participation, market data and DeFi TVL. It separates live source observations from calculations and from questions the available data cannot answer. It does not connect a wallet, sign or submit transactions, or give investment advice.

## What works

- The browser reads NEAR mainnet through FastNear’s public free-tier endpoint. It shows the latest finalized block, its age and gas fields, NEAR node status, and the current RPC-reported validator set.
- For a sampled finalized block, the app requests every shard chunk referenced by the block and counts its transaction arrays only after each chunk’s shard ID, hash and inclusion height match. Samples are at least five minutes apart; transaction identities and contents are not retained.
- CoinGecko supplies timestamped NEAR market data and daily history. DefiLlama supplies an independent spot-price check and dated daily TVL. The app only compares the two spot prices when their provider timestamps are within five minutes.
- Daily price, market-volume and TVL observations are aligned on exact UTC dates. The current partial UTC day is excluded. Complete 7-, 14- and 30-day endpoint-to-endpoint changes, charts with accessible data tables, and a selectable descriptive correlation test are available.
- Six risk cards separate state, severity, trend, confidence and evidence. The adjustable 5–50% decline threshold applies only to the specified price and TVL signals. Missing evidence stays unrated; the overall NEAR Ecosystem Health Score is withheld.
- The dashboard exports its current observations, source statuses and provenance as JSON. `npm run rebuild` writes a dated evidence snapshot without synthetic data.

## What remains unmeasured

A transaction count in one block is not a daily activity trend, a count of people, adoption, or retention. This MVP has no authorized daily account/cohort history, returning-user retention, historical validator series, full contract or application concentration inventory, reconciled bridge/Intents net-flow history, or long-run RPC uptime record. CoinGecko volume is gross exchange activity; DefiLlama TVL is a dollar-denominated asset stock. Neither is net investment or protocol revenue.

These gaps are shown in the interface and documentation rather than filled with estimates. See the [methodology](docs/methodology.md), [source inventory](docs/data-sources.md), [live provider research](docs/live-data-research.md), and [implementation status](docs/implementation-status.md).

## Run locally

Requirements: Node.js 18 or later. There are no third-party npm runtime dependencies.

```bash
npm test
npm run check
npm run dev
```

Open `http://127.0.0.1:8000`. The server binds to loopback only, serves the local files with a restrictive Content Security Policy, and does not proxy or store provider credentials. The browser makes read-only requests directly to the listed public feeds. Running the app does not publish it.

To refresh the checked-in evidence snapshot:

```bash
npm run rebuild
```

The rebuild fetches connected public sources, records source-by-source timestamps and failures, and writes `data/latest-evidence.json`. It also preserves the raw finalized-block response, returned daily market arrays and TVL rows; it does not save transaction identities or chunk contents. Disconnected candidate sources are listed as not connected, not queried. A snapshot is dated evidence—not a substitute for the live dashboard or a freshness guarantee.

## Reproducibility and verification

`npm test` runs 21 deterministic analytics, source, import-safety and local-server tests. `npm run check` performs JavaScript syntax checks. The browser verification confirmed all eight connected feeds responding, validator metrics, a complete all-shard transaction sample, the 30-day data table, risk controls, a selected hypothesis and JSON export. It reported no browser console/page errors and no page-wide horizontal overflow at 390px; the section navigation is intentionally horizontally scrollable.

Synthetic values appear only in isolated unit-test fixtures. They are never used as dashboard fallbacks.

## Provider and privacy caveats

NEAR’s [official RPC provider list](https://docs.near.org/api/rpc/providers) identifies `https://free.rpc.fastnear.com` as a public FastNear mainnet endpoint with a free tier. The listed request limit is “Not published,” and archival access is paid-only. The app uses only current/finalized reads and polls conservatively; a public endpoint response is not a service guarantee or a network-wide health assessment.

The [CoinGecko keyless API](https://docs.coingecko.com/docs/keyless-public-api) is intended for testing, open-source and educational use, has a shared dynamic limit, and requires attribution. The app fetches its market snapshot/history on load or user refresh rather than background-polling it. Provider access and terms must be reviewed again before any public deployment. No key, wallet, private transaction data or user record is sent.

## Local screenshots and release status

- [Desktop overview](screenshots/near-signal-overview.png)
- [Risk radar](screenshots/near-signal-risk-radar.png)
- [Mobile overview](screenshots/near-signal-mobile.png)
- [Silent local walkthrough](screenshots/near-signal-demo.mp4)
- [Submission draft and checklist](docs/submission-package.md)
- [Competitor analysis](docs/competitor-analysis.md)

This is still a local project. No public repository, deployment, X post or hackathon submission has been created. Public release and submission of this changed project require explicit approval; that approval is still pending. No license has been selected.
