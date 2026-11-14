# Architecture

NEAR SIGNAL is a static, browser-rendered MVP. There is no backend, account system, wallet connection, database, or transaction-signing path. The original working application remains runnable with a static HTTP server.

## Data flow

1. `src/data.js` requests four public feeds in parallel: NearBlocks `/v3/txn-stats`, `/v3/address-stats`, and `/v3/txns`, plus `status` from `https://rpc.mainnet.near.org`.
2. The data layer records per-feed success/error and fetch time. A failed feed does not synthesize replacement values.
3. `src/analytics.js` normalizes source values, inner-joins transactions and accounts on UTC date, omits the current UTC date, and requires complete contiguous windows for comparative changes. Metric means return `null` if any day in the relevant window lacks that metric.
4. `src/app.js` renders SVG charts, current/prior means, indexed-fee and account indicators, risk states/confidence, and the deterministic hypothesis test. The UI exposes source URLs, API documentation, timestamps, and caveats.
5. The browser Export button saves the current normalized rows and calculations as JSON. `npm run rebuild` independently fetches public NearBlocks feeds and writes `data/latest-evidence.json` for a reproducible dated snapshot.

## Design choices

The browser architecture avoids storing a private credential and makes read-only operation visible. It also means no private key or authenticated API key can be safely embedded in the app. If a provider key is required, move the request behind a minimal server-side proxy with rate limiting, key storage, and caching before public release.

NearBlocks currently serves as a third-party indexer, not a consensus source. The dashboard distinguishes indexed fees from protocol revenue, account identifiers from people, gross indexed activity from net capital, and a single RPC response from uptime history. Data freshness is based on the latest complete date matched across daily feeds.

The NEHS methodology is present, but the numeric score is intentionally withheld because capital, network-wide concentration/dependency, and infrastructure history are not covered. Any proposed category weights are visibly marked provisional and are not applied to produce a score.

## Verification

- `npm test`: nine deterministic unit tests, including source joins, date gaps, strict missing-data handling, HHI, Pearson correlation, alert thresholds, and hypothesis verdicts.
- `npm run check`: syntax checks for analytics, feeds, UI, and rebuild script.
- `npm run rebuild`: live source ingestion and 14-day calculation.
- Chromium interaction check: live feeds loaded; window/metric selectors, risk threshold, hypothesis form, and 390px mobile layout passed. Screenshots are under `screenshots/`.

## Not implemented

No BigQuery credentials or SQL query pipeline, persistent time-series store, server-side API-key proxy, Intents/bridge flow indexer, account-cohort retention, full contract-level concentration, validator history, alert scheduler, user-saved hypotheses, AI explanation service, or public deployment is included. See [the source inventory](data-sources.md) and [submission package](submission-package.md) for release blockers.
