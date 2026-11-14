# NEAR SIGNAL

**A read-only NEAR research dashboard that shows its evidence—and its gaps.**

NEAR SIGNAL separates finalized-block observations, current validator data, market context and DeFi TVL. It does not connect wallets, sign transactions, or fill missing measurements with proxies. The existing public app is at [near-signal-one.vercel.app](https://near-signal-one.vercel.app).

## Run it locally

Requirements: Node.js 18 or later. There are no third-party npm runtime dependencies.

```bash
npm test
npm run check
npm run rebuild
npm run dev
```

Open `http://127.0.0.1:8000`. `npm run rebuild` fetches the current connected public feeds and then creates offline replay inputs; `npm run replay` replays the saved evidence without network access.

## What works in the dashboard

The six routed workspaces are Overview, Thesis Challenge Engine, Ecosystem Risk Radar, Value Capture Lab, Network Activity & Validators, and Liquidity & TVL Context. The desktop sidebar and mobile drawer support direct links and browser history.

- **Thesis Challenge Engine:** compares selected daily market/TVL series over a complete matched window. It shows the source requests, method, observation times and limitations, and can export the sourced inputs.
- **Ecosystem Risk Radar:** shows source-backed signals, applies user-visible market/TVL thresholds, and distinguishes potential impact from confidence. Missing evidence does not become a risk score.
- **Value Capture Lab:** estimates a hypothetical gas budget using the latest finalized-block gas price and separately timestamped market price. This is not a fee ledger or transaction quote.
- **Network Activity & Validators:** reads current validator participation, offers a user-initiated account lookup, and samples transactions for one finalized block. The sample is counted only if each newly included shard chunk matches the finalized block.
- **Liquidity & TVL Context:** charts daily NEAR DeFi TVL as a USD asset stock, matched to exact UTC market-history dates.

Charts disclose their source request or calculation, provide a plain-language explanation, and offer exact-value CSV export. Source errors, retained values and stale observations are labeled. No market or chain metric is synthesized when a provider is unavailable.

## Connected feeds and limits

The app uses eight read-only feeds: FastNEAR public mainnet RPC for finalized blocks, node status and current validators; FastNEAR Neardata for exact-height block/shard samples; CoinGecko for current market data and daily history; and DefiLlama for spot price and daily TVL. Providers can change availability, limits, caching or terms, so a successful response is not an SLA.

A finalized-block sample is not daily activity or a user count. Daily account cohorts, historical transaction/contract trends, retention, full fee/reward accounting, multi-epoch validator history, verified Intents completion and reconciled bridge/Intents net flows are not connected. Address counts would not establish people or organic adoption; market volume is gross exchange turnover; TVL is an asset stock, not net investment. Those indicators remain unavailable rather than being filled with mock values. See [`THESIS.md`](THESIS.md), [methodology](docs/methodology.md) and [source inventory](docs/data-sources.md).

## Rebuild and evidence files

`npm run rebuild` fetches the connected public sources and writes [`data/latest-evidence.json`](data/latest-evidence.json) with returned inputs, source timestamps/statuses, aligned chart observations and the chart/test recipes. It replays the saved block and chart inputs after the live refresh. Browser-local block history grows only while the page is open; it is not a chain archive. `npm run replay` reconstructs charts from an existing evidence file without contacting providers.

The optional Python ingestion CLI is separate from the dashboard. Its default one-shot Neardata read does not write to a database; PostgreSQL persistence and bounded backfill require an explicitly configured, authorized database and operator action. No external database is created or used by the web app. See [alternative ingestion notes](docs/alternative-data-infrastructure.md).

## Verification

- `npm test` runs deterministic data, analytics, provenance, replay and server tests.
- `npm run check` validates JavaScript syntax.
- `npm run test:ingestion` runs offline Python normalization/provider tests.
- `npm run test:e2e` runs the desktop/mobile browser suite against real read-only public providers; it can be affected by provider limits or outages.

The project is a research tool, not investment advice. No separate hackathon submission or public post has been made.
