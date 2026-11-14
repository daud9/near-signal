# Data-source inventory

NEAR SIGNAL uses eight read-only public feeds. Failed, malformed, stale or pending data is labeled rather than replaced with a proxy. A successful provider response is not an SLA, permission to exceed terms, or proof of complete historical coverage.

## Connected feeds

| Feed | Data used | Cadence | Important limit |
|---|---|---|---|
| FastNEAR public mainnet RPC — finalized block | Height, hash, time, per-shard gas used and gas limit | About once a minute while the page is open | One provider's finalized view, not a network-wide health guarantee. |
| FastNEAR Neardata — block/shard bundle | Transaction sample at the exact finalized RPC block height | One exact-height request at most every five minutes | Each newly included chunk must match its hash, shard and inclusion height. An earlier-height reference contributes zero. One block is not daily activity or a user count. |
| FastNEAR public mainnet RPC — node status | Chain ID, sync state and latest observed block/time | On load and then every five minutes | A single node status is not uptime history or a consensus-wide diagnosis. |
| FastNEAR public mainnet RPC — validators | Current/next validator sets, stake and epoch counters | On load and then every five minutes | Current set only; not a multi-epoch history or complete delegation map. |
| CoinGecko — market snapshot | Timestamped price, market cap, gross 24-hour exchange volume and change | On load or user refresh | Keyless access is for testing/open-source/education and is dynamically limited; exchange volume is not on-chain flow. |
| CoinGecko — daily market history | Daily price, market-cap and gross-volume observations | On load or user refresh | External market context, not network activity. The partial current UTC day is excluded. |
| DefiLlama — spot price | Independently timestamped NEAR spot check | About every two minutes while the page is open | A cross-check, not an executable quote or on-chain oracle. |
| DefiLlama — historical NEAR TVL | Dated daily USD total value locked | On load and about every 30 minutes while the page is open | Asset stock, not deposits, net inflow, retention or protocol revenue. |

The header summarizes connected-feed response status. Relevant cards and exports show request/provider times. Historical market and TVL feeds use a 48-hour freshness threshold; shorter-interval feeds have source-specific thresholds. A failed refresh may retain a prior value, which is labeled as retained and, where applicable, stale.

## On-demand account lookup

The Network Activity & Validators workspace offers a user-initiated, read-only `view_account` query at `https://free.rpc.fastnear.com`. It returns the selected account's current finalized balance, locked amount, storage usage, code hash and block identity. The inspector shows the raw request/response and fetch timestamp and includes them only in a user-requested evidence export. It is not a scheduled feed or a historical adoption source.

## Collection and quality rules

- The browser calls connected sources directly. The local server is loopback-only and stores no provider credentials.
- The sampled block total is withheld if block identity/references do not match or a newly included shard is missing, duplicated or mismatched. Earlier-height references contribute zero. Full transaction bodies and receipt payloads are discarded.
- Daily market/TVL series are joined on exact UTC dates. Missing dates are not interpolated and the current partial UTC date is excluded.
- A 7-, 14- or 30-day endpoint change requires 8, 15 or 31 consecutive daily observations.
- Browser block history accrues only while the page is open; it is not a chain archive.

## Unavailable data

Daily signer/account cohorts, historical transaction and contract-usage trends, returning-user retention, complete historical fee/reward accounting, authenticated Intents records, reconciled bridge/Intents net flow, multi-epoch validator history and multi-provider uptime are not connected. No inactive provider candidates or fabricated measures appear as live feeds in the dashboard.

The separate Python ingestion path can read Neardata locally without persistence. PostgreSQL writes and bounded backfill require an authorized database, explicit configuration and operator action; this optional path does not power the static dashboard. See [alternative ingestion notes](alternative-data-infrastructure.md).
