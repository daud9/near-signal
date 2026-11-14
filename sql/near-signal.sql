-- NEAR SIGNAL sample: daily transactions, signer accounts, and contract function-call usage.
-- Source: https://docs.near.org/data-infrastructure/big-query
-- Dataset: bigquery-public-data.crypto_near_mainnet_us
-- Live-inspected tables/views: account_changes, accounts (view), blocks, chunks, circulating_supply, execution_outcomes, ft_balances_daily, ft_events, ft_events_contracts_by_account (materialized view), nft_events, nft_events_contracts_by_account (materialized view), receipt_actions, receipt_details, receipt_origin_transaction, transaction_actions, transactions
-- Live-inspected query fields: block_date (DATE), transaction_hash (STRING), signer_account_id (STRING), receipt_id (STRING), action_kind (STRING), receipt_receiver_account_id (STRING), receipt_predecessor_account_id (STRING), originated_from_transaction_hash (STRING)
-- Schemas inspected 2026-11-14; SQL not executed or dry-run. Review estimated bytes and obtain query budget approval.
-- Set @start_date DATE, @end_date DATE (exclusive), and @contract_account_id STRING. Accounts are signer proxies.

-- On-chain account/activity proxies, not verified people or organic adoption.
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
ORDER BY activity.block_date;
