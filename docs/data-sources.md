# Data-source inventory

## Integrated in the MVP

| Feed | Endpoint or method | What the app uses | Update/history | Limitation and release note |
|---|---|---|---|---|
| NearBlocks transaction statistics | `GET https://api.nearblocks.io/v3/txn-stats?limit=50` | Date, transaction count, indexed fee, indexed transaction volume, receipts | 50 returned dates in the latest rebuild; 49 joined complete UTC days through 2026-11-12. Dashboard refreshes on page load/manual refresh. | Third-party indexed data. Fees are not protocol revenue; volume is not net flow. The [API docs](https://api.nearblocks.io/api-docs) describe Bearer keys and attribution; published [API plans](https://nearblocks.io/apis) show free-tier personal-use restrictions, rate limits, and quotas. Test access without a key is not evidence of public-use permission. |
| NearBlocks account statistics | `GET https://api.nearblocks.io/v3/address-stats?limit=50` | Date, active account identifiers, active contracts, new contracts, meta accounts | Joined with transaction dates. | Addresses are not people or retention cohorts. The API docs do not promise full historical retention or an availability SLA. |
| NearBlocks latest transactions | `GET https://api.nearblocks.io/v3/txns?limit=100` | Signer identifiers for a small sample HHI | Fetched on page load/manual refresh. | A 100-row recent sample is not representative evidence of network-wide concentration. Never extrapolate it. |
| NEAR mainnet RPC | JSON-RPC `status` at `https://rpc.mainnet.near.org` | Chain ID, latest block height/time, sync flag when returned | One point-in-time request per refresh. | Public RPC capacity varies; a response is not an uptime history, validator concentration measure, or security audit. See [official provider limits](https://docs.near.org/api/rpc/providers) and [RPC method reference](https://docs.near.org/api/rpc/introduction). |

All sources and docs are also linked in the app’s live registry. The browser reported four successful source requests in the test run; the recent matched daily data ended on 12 November 2026. `npm run rebuild` generated a snapshot at 2026-11-14T00:09:06Z and wrote the selected feed URLs and row counts to `data/latest-evidence.json`.

## Researched, not connected

| Source | Potential use | Current status / why it is not integrated |
|---|---|---|
| [NEAR BigQuery public mainnet dataset](https://docs.near.org/data-infrastructure/big-query) (`bigquery-public-data.crypto_near_mainnet_us`) | Reproducible SQL over blocks, chunks, transactions, and execution outcomes; best candidate for independent historical validation. | Documented as public historical data, but no user query project, SQL job, cost guard, or validated output is configured. Exact coverage/freshness should be checked at runtime; the current MVP has no BigQuery result. |
| [NEAR Lake](https://docs.near.org/data-infrastructure/tutorials/running-near-lake/run-near-lake) | Historical block/shard objects for custom analysis. | Official retirement notice says new blocks stopped on 2026-03-24. Not a live ingestion path; historical object existence and AWS requester-pays access would need checking. |
| [NEAR Intents Explorer](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) | Historical 1Click Swap transaction records and aggregates for an explicitly bounded Intents analysis. | Not a complete Intents or NEAR ecosystem index. Programmatic API access requires a JWT/partner account and has one-request-per-five-seconds rate limiting. No app integration yet. |
| [DefiLlama NEAR overview](https://defillama.com/chain/near) and [bridge view](https://defillama.com/bridges/chain/near) | Chain-specific DeFi TVL, fees, stablecoins, DEX activity, and covered bridge flows. | Adapter-dependent coverage; TVL, net inflows, fees, and bridge movement have different definitions. Bridge API endpoints may require a plan. No data integrated. |
| [Dune NEAR directory](https://dune.com/blockchains/near) | Discover community query dashboards and their SQL provenance. | Dashboards are user-owned, provider provenance differs, and freshness can depend on refreshes/credits. No Dune query result is used as live evidence. |
| [Artemis](https://www.artemis.ai/docs/artemis-api/metrics/chains) | Normalized chain activity and financial metrics where a Near metric is explicitly supported. | Do not infer every metric is available for Near. API and plan constraints apply; not connected. |
| [Token Terminal NEAR metrics](https://tokenterminal.com/explorer/projects/near-protocol/metrics/all) | Standardized NEAR project metrics and financial statements. | 47-metric explorer inventory is useful for comparison, but API access/pricing and metric coverage/additivity require validation. Not connected. |

## Collection and quality rules

The dashboard only joins dates present in both essential NearBlocks feeds. It excludes the current UTC date and omits rows without transaction count or active-account count. It does not interpolate gaps. A comparative change requires two contiguous full windows. A metric mean is unavailable if any day in that window lacks that field. This limits the latest matched-data range to what both feeds actually returned.

The run timestamp is not the same as an indexer’s as-of date. Keep the “fetched at” value and latest matched UTC date separate. The checked-in snapshot is a dated artifact; regenerate it before analysis.
