# Implementation status

Updated **14 November 2026** during local MVP verification. This is a local project-state note, not a claim of public deployment.

## Implemented and locally verified

- Responsive, read-only dashboard with a loopback-only local server, source registry, provider/fetch times, stale/failure states and a header that remains in “checking” until all connected feeds are checked.
- Direct FastNear public mainnet RPC reads for finalized blocks, all referenced shard chunks, node status and the current validator set. Transaction totals are fail-closed on incomplete/mismatched chunks; no transaction identities are retained.
- Live block freshness and gas-cost estimate; a local browser observation chart; current active-set validator count, top-ten stake share, HHI and valid epoch production counters.
- CoinGecko timestamped spot/24-hour market fields and daily history, an independent DefiLlama spot timestamp, and DefiLlama dated daily TVL. Price-spread comparison requires provider timestamps within five minutes.
- Exact-date market/TVL joins, 7/14/30-day endpoint changes, gap-aware charts and accessible tables, a user-selectable daily Pearson test, six evidence-scoped risk cards, adjustable price/TVL alert threshold, withheld overall NEHS, and JSON evidence export.
- Timestamped local rebuild snapshot with raw returned daily arrays/block response, source statuses, aligned data and calculations. Imports have no network side effects.

## Verification results

The last full Chromium check at **2026-11-14 06:53 UTC** observed **all 8 connected feeds responding**. It displayed a current validator set of 343 records with 35.9% top-ten active-set stake share and a complete count of 3 transactions across 10 chunks in its sampled finalized block. It exercised the accessible skip link, source links, window/chart controls, risk threshold, selected hypothesis, JSON export and mobile view. No console errors, page errors or failed requests were reported; document width remained 390px at a 390px viewport (the section navigation scrolls horizontally by design). The subsequent local evidence rebuild at 06:54 UTC also received eight of eight connected-source responses, with zero failures.

`npm test` passes **21** deterministic analytics, timestamp/source, import-safety and server tests. `npm run check` passes all JavaScript syntax checks. The checked-in evidence snapshot can be newer or older than a later browser view; always inspect its `generatedAt` and source timestamps.

## Partial or unavailable

FastNear’s free RPC is provider-listed, public and CORS-tested in the local browser, but its numeric free-tier request limit is not published and the endpoint is non-archival. CoinGecko’s keyless service is intended for testing, open-source and educational use; review its current terms before public release. Provider access, caches and response timing can change.

Daily user/account cohorts, user retention, a daily transaction series, complete contract/application concentration, bridge/Intents net flows, a full delegated-stake map, multi-epoch validator history, network-wide uptime and incident history are not implemented. NearBlocks is not queried because test access did not establish third-party permission under its published terms. FastNear indexed history, Pikespeak, BigQuery and Intents history require credentials/project setup or additional scope/cost review. These are not presented as working features.

## External release status

The project remains local at `/workspace/near-signal`. No public repository was created, no app was deployed, and no X post or hackathon submission was made. Approval to publish the changed project is still pending; the previous Revenue Stress Lab approval does not carry over. GitHub repository creation remains unavailable through the current connected path. No license has been selected.
