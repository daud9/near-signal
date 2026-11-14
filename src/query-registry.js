export const BIGQUERY_DATASET = 'bigquery-public-data.crypto_near_mainnet_us';

export const BIGQUERY_INSPECTED_TABLES = [
  'account_changes', 'accounts (view)', 'blocks', 'chunks', 'circulating_supply',
  'execution_outcomes', 'ft_balances_daily', 'ft_events',
  'ft_events_contracts_by_account (materialized view)', 'nft_events',
  'nft_events_contracts_by_account (materialized view)', 'receipt_actions',
  'receipt_details', 'receipt_origin_transaction', 'transaction_actions', 'transactions',
];

export const BIGQUERY_INSPECTED_FIELDS = [
  'block_date (DATE)', 'transaction_hash (STRING)', 'signer_account_id (STRING)',
  'receipt_id (STRING)', 'action_kind (STRING)', 'receipt_receiver_account_id (STRING)',
  'receipt_predecessor_account_id (STRING)', 'originated_from_transaction_hash (STRING)',
];

// All three schemas were inspected in the authenticated BigQuery console on 2026-11-14.
// This SQL has not been executed or dry-run; a schema check is not a data integration.
export const BIGQUERY_ACTIVITY_QUERY = String.raw`-- On-chain account/activity proxies, not verified people or organic adoption.
-- Parameters: @start_date DATE inclusive; @end_date DATE exclusive;
-- @contract_account_id STRING, the exact receiver contract account.
WITH daily_activity AS (
  SELECT
    block_date,
    COUNT(DISTINCT transaction_hash) AS transaction_count,
    COUNT(DISTINCT signer_account_id) AS active_signer_accounts
  FROM \`bigquery-public-data.crypto_near_mainnet_us.transactions\`
  WHERE block_date >= @start_date AND block_date < @end_date
  GROUP BY block_date
),
receipt_origins AS (
  SELECT receipt_id, originated_from_transaction_hash
  FROM \`bigquery-public-data.crypto_near_mainnet_us.receipt_origin_transaction\`
  WHERE block_date >= @start_date AND block_date < @end_date
),
contract_usage AS (
  SELECT
    ra.block_date,
    COUNT(DISTINCT ro.originated_from_transaction_hash) AS contract_transactions,
    COUNT(DISTINCT ra.signer_account_id) AS contract_signer_accounts,
    COUNT(DISTINCT ra.receipt_id) AS function_call_receipts,
    COUNT(DISTINCT IF(ro.originated_from_transaction_hash IS NULL, ra.receipt_id, NULL))
      AS receipts_without_in_window_origin
  FROM \`bigquery-public-data.crypto_near_mainnet_us.receipt_actions\` AS ra
  LEFT JOIN receipt_origins AS ro ON ro.receipt_id = ra.receipt_id
  WHERE ra.block_date >= @start_date AND ra.block_date < @end_date
    AND ra.action_kind = 'FUNCTION_CALL'
    AND ra.receipt_receiver_account_id = @contract_account_id
  GROUP BY ra.block_date
)
SELECT
  activity.block_date,
  activity.transaction_count,
  activity.active_signer_accounts,
  COALESCE(usage.contract_transactions, 0) AS contract_transactions,
  COALESCE(usage.contract_signer_accounts, 0) AS contract_signer_accounts,
  COALESCE(usage.function_call_receipts, 0) AS function_call_receipts,
  COALESCE(usage.receipts_without_in_window_origin, 0) AS receipts_without_in_window_origin
FROM daily_activity AS activity
LEFT JOIN contract_usage AS usage USING (block_date)
ORDER BY activity.block_date;`;

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
    plainLanguage: 'This is a provider-reported USD asset stock matched to a market-history date; it is not deposits, bridge flow, net investment, or retained capital.',
    source: 'DefiLlama historical NEAR TVL and CoinGecko date matching',
    query: 'GET https://api.llama.fi/v2/historicalChainTvl/near\nGET https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=32&interval=daily\n\nKeep DefiLlama rows whose UTC date also appears in CoinGecko daily prices. Exclude the current UTC date and do not fill gaps.',
  },
};

export const BIGQUERY_REBUILD_NOTE = 'The live dataset inventory and all three query-table schemas were inspected in the authenticated BigQuery console on 14 Nov 2026. Each table is partitioned on block_date (DATE). This SQL has not been executed or dry-run; no application credentials, query project or spending approval is configured. Set explicit date/contract parameters and review estimated bytes before running it. Receipt-day origin counts cover only mappings in the selected date range; unmatched mappings are reported separately.';
