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

The dashboard has seven routed workspaces: Overview, Thesis Challenge Engine, Ecosystem Risk Radar, NEAR Ecosystem Flight Recorder, Value Capture Lab, Network Activity & Validators, and Liquidity & TVL Context. Direct links, browser history, desktop navigation and a mobile drawer are supported.

- **Thesis Challenge Engine:** compares selected daily market and TVL series over a complete matched window. It adds same-direction agreement counts and leave-one-day-out influence diagnostics without changing the Pearson verdict, exports the exact paired rows, and states that neither diagnostic is a confidence interval or robustness proof.
- **Ecosystem Risk Radar:** evaluates live stablecoin peg stress, a complete-window NEAR stablecoin supply contraction watch, dated NEAR-chain protocol TVL drawdowns and prior-epoch validator kickouts/slashing observations, alongside market and ecosystem TVL context. Stale threshold crossings remain visible as historical context but are excluded from active-finding counts.
- **NEAR Ecosystem Flight Recorder:** lets you select from a capped, browser-local log of finalized-block samples collected while the app is open. It compares per-shard gas and verified transaction shares only when the exact block and newly included shard chunks match. Separate context includes DEX activity, indexed fees, dated TVL, filtered protocol concentration, stablecoin quotes/circulation, market data and validator observations; it does not combine these asynchronous readings into a health score or causal claim.
- **Value Capture Lab:** estimates a hypothetical gas budget from the latest finalized-block gas price and a separately timestamped market price. It is an estimate, not a fee ledger or transaction quote.
- **Network Activity & Validators:** reads current validator participation, provides a user-initiated account lookup and samples transactions from one finalized block. A transaction is counted only when each newly included shard chunk matches that finalized block.
- **Liquidity & TVL Context:** charts daily NEAR DeFi TVL as a USD asset stock, matched to market-history observations on exact UTC dates.

Every chart explains its source request or derivation in plain language and offers exact-value CSV export. Source errors, stale observations and retained values are labeled. The static dashboard does not synthesize a market or chain metric when a provider is unavailable.

## Connected data

The app uses 15 read-only public feeds: FastNEAR public mainnet RPC for finalized blocks, node status, protocol configuration and current validators; FastNEAR Neardata for exact-height block/shard samples; CoinGecko for market snapshots and daily history; DefiLlama for spot price, daily TVL, selected NEAR protocol histories, stablecoin prices/current circulation and a separate dated NEAR stablecoin supply series, DEX activity and indexed fees; and GeckoTerminal for a bounded NEAR pool snapshot. Providers can change availability, limits, caching or terms; a successful response is not an SLA. Protocol and pool views have bounded provider coverage, not a census of every NEAR dApp or pool.

## Evidence, rebuilds and thesis materials

`npm run rebuild` writes [`data/latest-evidence.json`](data/latest-evidence.json), including returned feed inputs, source timestamps/statuses, risk states, aligned chart observations and chart/test recipes. It then replays the saved block and chart inputs. `npm run replay` can reconstruct charts from an existing evidence file offline.

In the Flight Recorder, **Export recorder evidence** downloads the selected block sample and context with calculations, source statuses, raw inputs and replay outputs. The browser-local log is capped at 60 samples and grows only while the app is open; it is not a chain archive. Run `npm run replay -- path/to/evidence.json` to reconstruct the exported per-shard records without network access.

The reproducible thesis and its limitations are documented in [`THESIS.md`](THESIS.md), [`docs/methodology.md`](docs/methodology.md), [`docs/data-sources.md`](docs/data-sources.md), and the [seven-domain risk research](docs/risk-radar-research/README.md).

## What is not connected or claimed

- BigQuery is not configured or connected.
- Daily user/account cohorts, historical transaction or contract-usage trends, retention, complete fee/reward accounting, and multi-epoch validator history are unavailable.
- Authenticated NEAR Intents activity and reconciled bridge/Intents net flows are not connected. This dashboard does not claim to verify Intents completion.
- There is no universal keyless NEAR APR/APY feed; unsupported yields are not inferred.

A one-block transaction sample is not daily activity, an adoption trend or a user count. Address counts do not establish people or organic adoption; market volume is gross exchange turnover; TVL is an asset stock, not net investment. Those measures remain unavailable rather than being filled with mock values.

The optional Python ingestion CLI is separate from the web app. Its default one-shot Neardata read does not write to a database; PostgreSQL persistence and bounded backfill require an explicitly configured, authorized database and operator action. The web app does not create or use an external database. See [alternative ingestion notes](docs/alternative-data-infrastructure.md).

## Verification

- Run `npm test` for deterministic data, analytics, provenance, replay and server regression checks; see `tests/analytics.test.js`, `tests/data.test.js`, and `tests/server.test.js`.
- Run `npm run check` to validate JavaScript syntax across the app, adapters, scripts and tests.
- Run `npm run test:ingestion` for offline Python normalization/provider tests.
- Run `npm run test:e2e` for desktop/mobile browser checks, including read-only provider flows, source-backed risk fixtures and the Thesis Challenge export; see `e2e/workspace.spec.js`. Live-provider checks can be affected by rate limits or outages.

NEAR SIGNAL is a research tool, not investment advice. No hackathon entry or public demo post has been made as of this revision.
