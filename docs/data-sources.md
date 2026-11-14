# Data-source inventory

NEAR SIGNAL uses 14 read-only public feeds. Failed, malformed, stale or pending data is labeled rather than replaced with a proxy. A successful response is not an SLA, permission to exceed a provider's limits, or proof of complete historical coverage.

## Connected feeds

| Feed | Data used | Cadence | Important limit |
|---|---|---|---|
| [FastNEAR public mainnet RPC — finalized block](https://docs.near.org/api/rpc/block-chunk) | Height, hash, time, per-shard gas used and gas limit | About once a minute while the page is open | One provider's finalized view, not a network-wide health guarantee. |
| [FastNEAR Neardata — block/shard bundle](https://docs.fastnear.com/neardata) | Transaction sample at the exact finalized RPC block height | One exact-height request at most every five minutes | Each newly included chunk must match its hash, shard and inclusion height. An earlier-height reference contributes zero. One block is not daily activity or a user count. |
| [FastNEAR public mainnet RPC — node status](https://docs.near.org/api/rpc/network) | Chain ID, sync state and latest observed block/time | On load and then every five minutes | A single node status is not uptime history or a consensus-wide diagnosis. |
| [FastNEAR public mainnet RPC — current validators](https://docs.fastnear.com/rpc/validators/validators-current) | Current and next sets, stake, block/chunk/endorsement counters, proposals, kickouts, slashing flags and protocol-reported prior-epoch validator rewards | On load and then every five minutes; snapshot retained between reads | Current/next sets only; not a multi-epoch history or a complete delegation map. Stake concentration is within the reported set. |
| [FastNEAR public mainnet RPC — block-specific protocol config](https://docs.near.org/api/rpc/protocol) | Protocol version and `burnt_gas_reward` ratio queried at the observed finalized block height | On load and when the block protocol version changes; otherwise rechecked about every 30 minutes | The runtime rule is not a realized fee-burn ledger. Gas used × gas price is still an estimate, not exact user debit or revenue. |
| [CoinGecko — market snapshot](https://docs.coingecko.com/docs/keyless-public-api) | Timestamped price, market cap, gross 24-hour exchange volume and change | On load or user refresh | Keyless access is for testing/open-source/education and dynamically limited; exchange volume is not on-chain flow. |
| [CoinGecko — daily market history](https://docs.coingecko.com/demo/reference/coins-id-market-chart) | Daily price, market-cap and gross-volume observations | On load or user refresh | External market context, not network activity. The partial current UTC day is excluded. |
| [DefiLlama — NEAR spot price](https://coins.llama.fi/prices/current/coingecko:near) | Independently timestamped NEAR spot check | About every two minutes while the page is open | A cross-check, not an executable quote or on-chain oracle. |
| [DefiLlama — historical NEAR TVL](https://api.llama.fi/v2/historicalChainTvl/near) | Long-run dated daily USD total value locked | On load and about every 30 minutes | Asset stock, not deposits, net inflow, retention or protocol revenue; the TVL chart does not require CoinGecko date matches. |
| [DefiLlama — NEAR protocol index and selected TVL histories](https://api.llama.fi/protocols) | Filtered index of non-CEX rows with reported NEAR TVL ≥ $100,000; dated `chainTvls.Near.tvl` histories for up to eight selected protocols | Index and detail reads on load and about every 30 minutes | Provider-indexed coverage, not a complete app census. A USD balance can move with token prices and adapter coverage; it is not a withdrawal or solvency ledger. |
| [DefiLlama — stablecoin price and NEAR circulation](https://stablecoins.llama.fi/stablecoins?includePrices=true) | USD-peg classification, price and reported NEAR-chain circulating value | On load and about every 30 minutes | No provider price timestamp/confidence field. Browser check time is recorded; a quote is not redemption or reserve proof. |
| [DefiLlama — NEAR DEX overview](https://api.llama.fi/overview/dexs/Near) | Dated chain DEX-volume observations and the provider's daily protocol breakdown when returned | On load and about every 30 minutes | DEX notional turnover can include arbitrage and routed trades; it is not pool depth, deposits, net inflow or investment. Exact seven-day sums and comparisons require complete consecutive daily points. |
| [DefiLlama — NEAR fees overview](https://api.llama.fi/overview/fees/Near) | Dated provider-indexed chain-fee observations | On load and about every 30 minutes | Not a reconciled transaction/receipt fee ledger, realized revenue, validator income or APY. Exact rolling sums require consecutive dated points. |
| [GeckoTerminal — NEAR pool page 1](https://api.geckoterminal.com/api/v2/networks/near/pools?page=1) | Up to 20 returned pool reserves, rolling volumes, buy/sell transaction counts and price changes | On load and about every five minutes; provider cache is one minute | Beta API with an approximate 10-call/minute public limit. Page 1 is bounded coverage, not all pools; pool reserves may overlap and are not chain TVL. |

The header summarizes connected-feed response status. Relevant panels and exports show request/provider times. Historical market, TVL, DEX and fee observations use a 48-hour freshness threshold; stablecoin snapshots use two hours; other sources use source-specific thresholds. A failed refresh may retain a prior value, which is labeled as retained and, where applicable, stale. Stablecoin quote checks are kept in browser-local storage for up to 72 hours to require two consecutive observations for smaller deviations.

## On-demand account lookup

The Network Activity & Validators workspace offers a user-initiated, read-only `view_account` query at `https://free.rpc.fastnear.com`. It returns the selected account's current finalized balance, locked amount, storage usage, code hash and block identity. The inspector shows the raw request/response and fetch timestamp and includes them only in a user-requested evidence export. It is not a scheduled feed or a historical adoption source.

## Collection and quality rules

- The browser calls connected sources directly. The local server is loopback-only and stores no provider credentials.
- The sampled block total is withheld if block identity/references do not match or a newly included shard is missing, duplicated or mismatched. Earlier-height references contribute zero. Full transaction bodies and receipt payloads are discarded.
- Market/TVL joins used by the overview and thesis test match exact UTC dates. The standalone TVL chart uses DefiLlama's own dated history. Missing dates are not interpolated and the current partial UTC date is excluded.
- A 7-, 14- or 30-day endpoint change requires 8, 15 or 31 consecutive daily observations. A seven-day sum requires seven consecutive dates; comparing adjacent seven-day sums requires 14.
- Pool-page aggregates describe only rows actually returned on page 1, and report how many rows contributed values. They are not presented as chain-wide totals.
- Browser block history accrues only while the page is open; it is not a chain archive. Evidence exports include transformed source rows and the chart requests needed for offline replay.

## Unavailable data

Daily signer/account cohorts, historical transaction and contract-usage trends, returning-user retention, receipt-level fee/reward accounting, authenticated Intents records, reconciled bridge/Intents net flow, multi-epoch validator history, multi-provider uptime, and a universal keyless NEAR APR/APY catalog are not connected. DefiLlama's public yield routes stopped working on 13 November 2026; no replacement paid source or API key is used. Per-protocol APY alerts require verified contract methods and fee/reward accounting, so unsupported rates are not inferred from TVL, DEX volume or token price. No inactive provider candidates or fabricated measures appear as live feeds in the dashboard.

The separate Python ingestion path can read Neardata locally without persistence. PostgreSQL writes and bounded backfill require an authorized database, explicit configuration and operator action; this optional path does not power the static dashboard. See [alternative ingestion notes](alternative-data-infrastructure.md).
