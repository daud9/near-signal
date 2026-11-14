export const CHART_QUERY_RECIPES = {
  overviewChart: {
    title: 'Daily market and liquidity context',
    plainLanguage: 'Each point uses a complete UTC date shared by the market and TVL sources; missing dates and the current partial day are excluded.',
    source: 'CoinGecko daily market history and DefiLlama historical NEAR TVL',
    query: 'GET https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=32&interval=daily\nGET https://api.llama.fi/v2/historicalChainTvl/near\n\nJoin on the exact UTC calendar date. Select priceUsd, tvlUsd, or grossVolumeUsd from the matched rows. No date interpolation is applied.',
  },
  gasChart: {
    title: 'Gas used per sampled finalized block',
    plainLanguage: 'This chart records real finalized-block gas observations collected in this browser; it is not a historical chain archive or a fee-revenue series.',
    source: 'NEAR mainnet JSON-RPC through FastNear',
    query: '{"jsonrpc":"2.0","id":"near-signal-block","method":"block","params":{"finality":"final"}}\n\nFor each returned block, sum chunks[].gas_used, then divide by 10^12 to display Tgas. Retain the raw block and observation timestamp in browser-local evidence history. Export evidence, then run npm run replay -- path/to/evidence.json to reconstruct each point offline.',
  },
  blockTxChart: {
    title: 'Transactions per sampled finalized block',
    plainLanguage: 'The total is shown only when the returned Neardata block matches the finalized RPC block and every newly included chunk matches its shard, hash, and inclusion height. An earlier-height reference contributes zero transactions for this block.',
    source: 'FastNEAR Neardata at the exact finalized RPC block height',
    query: 'GET https://free.rpc.fastnear.com JSON-RPC block(finality=final)\nGET https://mainnet.neardata.xyz/v0/block/{finalizedHeight}\n\nMatch block identity/hash and each block shard reference to the finalized RPC block. For height_included equal to this block height, require the exact chunk hash and a valid transaction array, then count its transactions. A reference with an earlier height_included contributes zero; its old chunk body is not recounted. A missing or mismatched newly included chunk withholds the total. Retain the raw block references, current-height matched chunks and transaction hashes; full transaction bodies and receipt payloads are discarded. npm run replay -- path/to/evidence.json repeats validation offline.',
  },
  capitalChart: {
    title: 'NEAR DeFi total value locked',
    plainLanguage: 'This is the full available dated provider-reported USD asset stock from DefiLlama, shown without requiring CoinGecko history; the current partial UTC date is excluded. It is not deposits, bridge flow, net investment, or retained capital.',
    source: 'DefiLlama historical NEAR TVL',
    query: 'GET https://api.llama.fi/v2/historicalChainTvl/near\n\nConvert each row date from Unix seconds to a UTC date, retain valid nonnegative TVL observations, exclude the current UTC calendar date, and keep gaps visible. Window changes require consecutive daily observations.',
  },
  dexVolumeChart: {
    title: 'NEAR chain DEX volume',
    plainLanguage: 'Each point is a DefiLlama-reported dated USD DEX-volume observation for NEAR. Turnover can include arbitrage and routed trades and is not deposits, net capital flow, pool depth or investment.',
    source: 'DefiLlama NEAR DEX overview endpoint',
    query: 'GET https://api.llama.fi/overview/dexs/Near\n\nRead totalDataChart as [Unix-seconds, USD-volume] observations. Validate finite nonnegative values, convert to UTC dates, sort by date, exclude the current partial UTC day from full-day summaries, and do not interpolate gaps. A 7-day sum requires 7 consecutive daily points; its comparison to the previous 7 days requires 14 consecutive points.',
  },
  feeHistoryChart: {
    title: 'DefiLlama-indexed NEAR chain fees',
    plainLanguage: 'Daily USD fee observations reported by DefiLlama for NEAR. These provider-indexed values are not a reconciled transaction/receipt fee ledger, realized protocol revenue, validator income or APY.',
    source: 'DefiLlama NEAR fees overview endpoint',
    query: 'GET https://api.llama.fi/overview/fees/Near\n\nRead totalDataChart as [Unix-seconds, USD-fee] observations. Validate finite nonnegative values, convert to UTC dates, sort by date, exclude the current partial UTC day from full-day summaries, and do not interpolate gaps. A 7-day sum requires 7 consecutive daily points; its comparison to the previous 7 days requires 14 consecutive points.',
  },
};

export const THESIS_TEST_RECIPE = {
  title: 'Thesis Challenge Engine — daily market/TVL co-movement test',
  plainLanguage: 'This descriptive test checks whether daily percentage changes in two selected provider series moved together on the same UTC dates. It does not test causation, adoption, settlement or future returns.',
  sources: [
    'CoinGecko NEAR daily market history: https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=32&interval=daily',
    'DefiLlama NEAR historical TVL: https://api.llama.fi/v2/historicalChainTvl/near',
  ],
  query: 'GET https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=32&interval=daily\nGET https://api.llama.fi/v2/historicalChainTvl/near',
  method: [
    'Convert provider timestamps to UTC calendar dates; exclude the current partial UTC date.',
    'For each selected series, compute daily percentage change only where the previous observation is exactly one UTC day earlier; do not fill missing values or bridge gaps.',
    'Match percentage changes by their UTC end date and use the latest complete consecutive window of exactly 7, 14 or 30 changes.',
    'Calculate Pearson correlation r over that full selected window. The visible ±0.30 direction rule is a product threshold, not a statistical-significance test.',
  ],
  limitations: [
    'Correlation describes co-movement only. No p-value, causal effect, independence claim or forecast is calculated.',
    'Market price, market volume and USD TVL can share market-price effects; they are not independent measures of on-chain usage.',
    'A result does not establish human users, organic adoption, retention, Intents settlement, net flows or protocol value capture.',
    'If the selected complete consecutive window is not present, the result is insufficient evidence; no missing values are synthesized.',
  ],
};
