# NEAR SIGNAL

**An evidence-first, read-only dashboard for testing an investment thesis about NEAR.**

NEAR SIGNAL brings finalized-block observations, current validator data, market context, stablecoin stress and NEAR DeFi TVL into one research interface. It exposes the source and calculation behind its charts—and labels missing or stale evidence instead of filling gaps with proxies. The public app is at [near-signal-one.vercel.app](https://near-signal-one.vercel.app/).

The dashboard does not connect wallets or sign transactions. Its market and chain views depend on public data providers, so availability, freshness and rate limits can vary.

## Run it locally

Requirements: Node.js 18 or later. There are no third-party npm runtime dependencies.

```bash
npm test
npm run check
npm run rebuild
npm run dev
```

Open `http://127.0.0.1:8000`. `npm run rebuild` refreshes connected public feeds and then generates offline replay inputs. `npm run replay` rebuilds charts from saved evidence without contacting providers.

## What works now

The dashboard has six routed workspaces: Overview, Thesis Challenge Engine, Ecosystem Risk Radar, Value Capture Lab, Network Activity & Validators, and Liquidity & TVL Context. Direct links, browser history, desktop navigation and a mobile drawer are supported.

- **Thesis Challenge Engine:** compares selected daily market and TVL series over a complete matched window. It shows source requests, method, observation times and limitations, and exports the sourced inputs.
- **Ecosystem Risk Radar:** evaluates live stablecoin peg stress, dated NEAR-chain protocol TVL drawdowns and prior-epoch validator kickouts/slashing observations, alongside market and ecosystem TVL context. Each card shows observed values, severity, source confidence/status and reproducible requests. Missing evidence is not converted into an alert.
- **Value Capture Lab:** estimates a hypothetical gas budget from the latest finalized-block gas price and a separately timestamped market price. It is an estimate, not a fee ledger or transaction quote.
- **Network Activity & Validators:** reads current validator participation, provides a user-initiated account lookup and samples transactions from one finalized block. A transaction is counted only when each newly included shard chunk matches that finalized block.
- **Liquidity & TVL Context:** charts daily NEAR DeFi TVL as a USD asset stock, matched to market-history observations on exact UTC dates.

Every chart explains its source request or derivation in plain language and offers exact-value CSV export. Source errors, stale observations and retained values are labeled. The static dashboard does not synthesize a market or chain metric when a provider is unavailable.

## Connected data

The app connects ten read-only public feeds: FastNEAR public mainnet RPC for finalized blocks, node status and current validators; FastNEAR Neardata for exact-height block/shard samples; CoinGecko for market snapshots and daily history; and DefiLlama for spot price, daily ecosystem TVL, selected NEAR protocol histories, and stablecoin prices/circulation. Providers can change availability, limits, caching or terms; a successful response is not an SLA. The protocol risk view covers at most eight eligible non-CEX protocols, not every NEAR dApp.

## Evidence, rebuilds and thesis materials

`npm run rebuild` writes [`data/latest-evidence.json`](data/latest-evidence.json), including returned feed inputs, source timestamps/statuses, risk states, aligned chart observations and chart/test recipes. It then replays the saved block and chart inputs. `npm run replay` can reconstruct charts from an existing evidence file offline.

The reproducible thesis and its limitations are documented in [`THESIS.md`](THESIS.md), [`docs/methodology.md`](docs/methodology.md), [`docs/data-sources.md`](docs/data-sources.md), and the [seven-domain risk research](docs/risk-radar-research/README.md).

## What is not connected or claimed

- BigQuery is not configured or connected.
- Daily user/account cohorts, historical transaction or contract-usage trends, retention, complete fee/reward accounting, and multi-epoch validator history are unavailable.
- Authenticated NEAR Intents activity and reconciled bridge/Intents net flows are not connected. This dashboard does not claim to verify Intents completion.
- There is no universal keyless NEAR APR/APY feed; unsupported yields are not inferred.

A one-block transaction sample is not daily activity, an adoption trend or a user count. Address counts do not establish people or organic adoption; market volume is gross exchange turnover; TVL is an asset stock, not net investment. Those measures remain unavailable rather than being filled with mock values.

The optional Python ingestion CLI is separate from the web app. Its default one-shot Neardata read does not write to a database; PostgreSQL persistence and bounded backfill require an explicitly configured, authorized database and operator action. The web app does not create or use an external database. See [alternative ingestion notes](docs/alternative-data-infrastructure.md).

## Verification

- `npm test` runs deterministic data, analytics, provenance, replay and server tests.
- `npm run check` validates JavaScript syntax.
- `npm run test:ingestion` runs offline Python normalization/provider tests.
- `npm run test:e2e` runs desktop/mobile browser checks, including read-only public-provider flows and deterministic current-schema risk fixtures. Live-provider checks can be affected by rate limits or outages.

NEAR SIGNAL is a research tool, not investment advice. No hackathon entry or public demo post has been made as of this revision.
