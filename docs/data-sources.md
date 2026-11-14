# Data-source inventory

The app has eight connected read-only feeds and five documented-but-disconnected candidates. A source marked “not connected” is not queried. A successful test response is not an SLA or permission to exceed the provider’s terms.

## Connected in the MVP

| Feed | Endpoint or methods | What is used | Cadence | Limitation |
|---|---|---|---|---|
| FastNear public NEAR mainnet RPC | `https://free.rpc.fastnear.com`; JSON-RPC `block`, `chunk`, `status`, `validators` | Finalized block header and shard references; complete sampled per-block transaction count; node-reported mainnet/sync status; current validator stakes and epoch counters. | Block roughly every 60 seconds; all-shard transaction sample on load then at least five minutes apart; status and validators on load then every five minutes. | NEAR’s [provider list](https://docs.near.org/api/rpc/providers) lists this public free-tier endpoint, says its request limit is “Not published,” and marks archival access paid-only. It is sufficient for current reads, not historical queries. Provider views are not consensus-wide uptime or security assurances. |
| CoinGecko keyless market snapshot | [Simple-price API](https://docs.coingecko.com/demo/reference/simple-price) | Timestamped NEAR USD price, market cap, gross 24-hour volume and price change. | On page load or manual refresh; refresh is throttled and not background-polled. | [Keyless API guidance](https://docs.coingecko.com/docs/keyless-public-api) describes a shared dynamic limit and testing/open-source/educational use. Public release needs a fresh terms/access review and visible attribution. Gross market volume is not a chain flow. |
| CoinGecko daily market history | [Market-chart API](https://docs.coingecko.com/demo/reference/coins-id-market-chart) | Timestamped daily price, market-cap and volume points for date matching and charts. | On page load or manual refresh. | It is market-provider history, not network activity. The current partial UTC date is excluded; dates without a matching TVL point are not filled. |
| DefiLlama spot check | [Current NEAR price endpoint](https://coins.llama.fi/prices/current/coingecko:near) | An independently timestamped spot-price check. | About every two minutes while the page is open. | Not an independent market-venue aggregate; its timestamp must be within five minutes of CoinGecko before the app shows a price spread. |
| DefiLlama NEAR TVL history | [Historical chain TVL endpoint](https://api.llama.fi/v2/historicalChainTvl/near) and [metric definitions](https://docs.llama.fi/analysts/data-definitions) | Dated daily USD TVL stock, aligned to CoinGecko dates. | About every 30 minutes while the page is open. | TVL is provider-covered asset value, not net inflow, capital retention, protocol revenue or all NEAR liquidity. |

At the last full Chromium check, all eight connected feeds responded. Check the live registry and snapshot for current per-source status; this row is not a promise that public providers will remain available.

## Investigated but not connected

| Candidate | Possible contribution | Why it is not used |
|---|---|---|
| NearBlocks daily indexed history | Daily transactions, account identifiers, fees and contract counts. | Its [free plan](https://nearblocks.io/apis) is personal-use, and its [terms](https://nearblocks.io/terms) require written consent for third-party apps and prohibit automated data collection. Unauthenticated test access did not establish permission. The live MVP makes no NearBlocks requests. Its API documentation also announced legacy v1/v2 shutdown for 22 November 2026. |
| FastNear indexed history API | Historical transactions/accounts beyond latest RPC reads. | Separate from the free RPC endpoint: provider docs require an API key. A key is not embedded in this browser app, and the exact query/plan is not configured. |
| Pikespeak daily account history | Provider-reported daily active-account addresses. | The OpenAPI exposes a daily endpoint but access is key-gated. No key is configured. Address counts would still not verify people, retention or organic adoption. |
| NEAR public BigQuery dataset | Independent historical blocks, transactions, actions, receipts and account changes. | NEAR’s [BigQuery guide](https://docs.near.org/data-infrastructure/big-query) requires a Google Cloud project and query setup; storage may be free but query processing can be billable. No SQL job, auth, budget guard or validated query output is implemented. |
| NEAR Intents Explorer | A narrow history of 1Click Swap records. | The [Explorer API](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction) requires partner JWT access and is not a complete index of all Intents or ecosystem flows. No secret is put in browser code. |

Additional research found that NEAR Lake stopped receiving new blocks on 24 March 2026; DefiLlama bridge endpoints returned a paid-plan response and did not establish complete reconciled NEAR-directed net flows. Dune, Artemis and Token Terminal may aid later research but do not supply verified, no-key feeds in this build. Details and direct source citations are in [live data research](live-data-research.md).

## Collection and quality rules

- Data is fetched directly from documented public sources. The local server is loopback-only, has no provider proxy, and stores no provider keys.
- The live block count is withheld unless every referenced chunk has a transaction array and matches the block’s shard ID, chunk hash and inclusion height. NEAR’s documented chunk response does not include a separate `block_hash` field.
- Daily market and TVL dates are joined exactly in UTC. The current partial UTC date is excluded; gaps are never interpolated.
- A 7-, 14- or 30-day endpoint change requires 8, 15 or 31 consecutive daily observations, respectively.
- Source failures, stale observations and missing data remain visible. The app retains last-good values with their last successful provider timestamp after a later failure.
- The browser export and local rebuild snapshot preserve source provenance. Transaction identities, transaction contents and receipts are not retained.
