# Live BigQuery schema inspection

The authenticated Google Cloud console displayed the dataset [`bigquery-public-data.crypto_near_mainnet_us`](https://console.cloud.google.com/bigquery?project=bigquery-public-data&p=bigquery-public-data&d=crypto_near_mainnet_us&page=dataset) on 14 November 2026. This inspection used the dataset/table schema UI only; no query was executed and no data preview was opened.

## Dataset inventory

The console displayed all **16 objects** (1–16 of 16): `account_changes`, `accounts` (view), `blocks`, `chunks`, `circulating_supply`, `execution_outcomes`, `ft_balances_daily`, `ft_events`, `ft_events_contracts_by_account` (materialized view), `nft_events`, `nft_events_contracts_by_account` (materialized view), `receipt_actions`, `receipt_details`, `receipt_origin_transaction`, `transaction_actions`, and `transactions`. All objects not marked view/materialized view were tables.

The live inventory confirms **`receipt_origin_transaction`**, resolving the stale `receipt_origin` name in NEAR's documentation table inventory. No objects named `receipt_origin` or `receipts` appeared in this complete 16-object list.

## `transactions`

The console labels this table partitioned. Its schema describes `block_date` as “The date of the Block. Used to partition the table.” All displayed fields have NULLABLE mode.

| Field | Type |
|---|---|
| block_date | DATE |
| block_height | INTEGER |
| block_timestamp | INTEGER |
| block_timestamp_utc | TIMESTAMP |
| block_hash | STRING |
| chunk_hash | STRING |
| shard_id | INTEGER |
| transaction_hash | STRING |
| index_in_chunk | INTEGER |
| signer_account_id | STRING |
| signer_public_key | STRING |
| nonce | INTEGER |
| receiver_account_id | STRING |
| signature | STRING |
| status | STRING |
| converted_into_receipt_id | STRING |
| receipt_conversion_gas_burnt | INTEGER |
| receipt_conversion_tokens_burnt | FLOAT |

## `receipt_actions`

The console labels this table partitioned. `block_date` is DATE and described as the partition field. All displayed fields have NULLABLE mode.

| Field | Type |
|---|---|
| block_date | DATE |
| block_height | INTEGER |
| block_timestamp | INTEGER |
| block_timestamp_utc | TIMESTAMP |
| block_hash | STRING |
| chunk_hash | STRING |
| shard_id | INTEGER |
| index_in_action_receipt | INTEGER |
| receipt_id | STRING |
| gas_price | STRING |
| signer_account_id | STRING |
| signer_public_key | STRING |
| args | STRING |
| receipt_predecessor_account_id | STRING |
| action_kind | STRING |
| receipt_receiver_account_id | STRING |
| is_delegate_action | BOOLEAN |

The schema describes `signer_account_id` as the account on whose behalf the origin transaction is signed. `action_kind` lists `ADD_KEY`, `CREATE_ACCOUNT`, `DELEGATE_ACTION`, `DELETE_ACCOUNT`, `DELETE_KEY`, `DEPLOY_CONTRACT`, `FUNCTION_CALL`, `STAKE`, and `TRANSFER`. The predecessor may be `system` for gas/deposit refunds. The receiver is the destination account ID.

## `receipt_origin_transaction`

The console labels this table partitioned and describes `block_date` as its partition field. All fields are NULLABLE.

| Field | Type |
|---|---|
| block_date | DATE |
| block_height | INTEGER |
| receipt_kind | STRING |
| receipt_id | STRING |
| data_id | STRING |
| originated_from_transaction_hash | STRING |
| _record_last_updated_utc | TIMESTAMP |

`originated_from_transaction_hash` is the transaction hash that originated the receipt. The sample query uses the exact live relation name, applies a `block_date` range to all three scanned relations, and obtains receipt signers directly from `receipt_actions`. It reports receipts without an in-window origin mapping separately, so date-boundary or missing mappings are visible rather than silently discarded.

No data query or dry-run was submitted. Data freshness, result completeness and query bytes are not established by a schema inspection. These facts do not imply that the application has BigQuery credentials, a query project or spending approval, or that any daily metric has been computed.
