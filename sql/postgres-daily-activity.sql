-- NEAR SIGNAL PostgreSQL activity queries (normalized_records schema).
-- Parameters: $1 = inclusive UTC timestamptz; $2 = exclusive UTC timestamptz.
-- No date spine is generated: a missing day is unavailable, not zero.
-- Rows are provider-scoped and reflect only records actually ingested; they do not
-- imply a complete day unless a complete-history ingestion interval is independently verified.

-- Daily transactions and distinct signer accounts among observed transaction rows.
-- Signer count is NULL if any observed transaction row lacks a signer field.
SELECT
  source_id,
  date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS utc_date,
  COUNT(DISTINCT transaction_hash) AS observed_transaction_count,
  CASE
    WHEN COUNT(*) FILTER (WHERE signer_account_id IS NULL) = 0
      THEN COUNT(DISTINCT signer_account_id)
    ELSE NULL
  END AS observed_distinct_signer_accounts,
  COUNT(*) FILTER (WHERE signer_account_id IS NULL) AS rows_without_signer,
  COUNT(*) AS ingested_transaction_rows,
  MIN(provider_observed_at) AS earliest_provider_timestamp,
  MAX(provider_observed_at) AS latest_provider_timestamp,
  MIN(observed_at) AS first_collected_at,
  MAX(observed_at) AS last_collected_at,
  ARRAY_AGG(DISTINCT source_endpoint ORDER BY source_endpoint) AS source_endpoints,
  ARRAY_AGG(DISTINCT ingestion_run_id::text ORDER BY ingestion_run_id::text) AS ingestion_runs,
  'Observed records only; source pagination and full-day completeness are not implied.' AS coverage_note
FROM normalized_records
WHERE network = 'mainnet'
  AND record_type = 'transaction'
  AND occurred_at >= $1
  AND occurred_at < $2
GROUP BY source_id, utc_date
ORDER BY utc_date, source_id;

-- Daily function-call transactions observed directly in transaction action arrays.
-- This does not count receipt-generated cross-contract calls; use a validated indexed
-- receipt dataset (e.g., BigQuery receipt_actions) for that broader definition.
SELECT
  source_id,
  date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS utc_date,
  contract_id,
  COUNT(DISTINCT transaction_hash) AS observed_function_call_transactions,
  CASE
    WHEN COUNT(*) FILTER (WHERE signer_account_id IS NULL) = 0
      THEN COUNT(DISTINCT signer_account_id)
    ELSE NULL
  END AS observed_signer_accounts,
  COUNT(*) FILTER (WHERE signer_account_id IS NULL) AS rows_without_signer,
  COUNT(*) AS ingested_transaction_rows,
  MIN(provider_observed_at) AS earliest_provider_timestamp,
  MAX(provider_observed_at) AS latest_provider_timestamp,
  MIN(observed_at) AS first_collected_at,
  MAX(observed_at) AS last_collected_at,
  ARRAY_AGG(DISTINCT source_endpoint ORDER BY source_endpoint) AS source_endpoints,
  ARRAY_AGG(DISTINCT ingestion_run_id::text ORDER BY ingestion_run_id::text) AS ingestion_runs,
  'Top-level transaction FunctionCall actions only; not all receipt-level contract activity.' AS coverage_note
FROM normalized_records
WHERE network = 'mainnet'
  AND record_type = 'transaction'
  AND occurred_at >= $1
  AND occurred_at < $2
  AND contract_id IS NOT NULL
  AND dimensions->'action_types' ? 'FunctionCall'
GROUP BY source_id, utc_date, contract_id
ORDER BY utc_date, source_id, contract_id;

-- Decoded events appear only after an authorized event provider has returned and
-- normalized them. An empty result here is not evidence of zero events.
SELECT
  source_id,
  date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS utc_date,
  contract_id,
  event_standard,
  event_name,
  COUNT(DISTINCT external_id) AS observed_event_count,
  MIN(provider_observed_at) AS earliest_provider_timestamp,
  MAX(provider_observed_at) AS latest_provider_timestamp,
  MIN(observed_at) AS first_collected_at,
  MAX(observed_at) AS last_collected_at,
  ARRAY_AGG(DISTINCT source_endpoint ORDER BY source_endpoint) AS source_endpoints,
  ARRAY_AGG(DISTINCT ingestion_run_id::text ORDER BY ingestion_run_id::text) AS ingestion_runs,
  'Observed decoded event records only; missing provider history is not zero.' AS coverage_note
FROM normalized_records
WHERE network = 'mainnet'
  AND record_type = 'event'
  AND occurred_at >= $1
  AND occurred_at < $2
GROUP BY source_id, utc_date, contract_id, event_standard, event_name
ORDER BY utc_date, source_id, contract_id, event_standard, event_name;

-- Intents records are provider-scoped and 1Click-limited; this counts records only,
-- not completed settlement, all routes, token-normalized volume, or net flow.
SELECT
  source_id,
  date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS utc_date,
  COUNT(DISTINCT external_id) AS observed_swap_record_count,
  MIN(provider_observed_at) AS earliest_provider_timestamp,
  MAX(provider_observed_at) AS latest_provider_timestamp,
  MIN(observed_at) AS first_collected_at,
  MAX(observed_at) AS last_collected_at,
  ARRAY_AGG(DISTINCT source_endpoint ORDER BY source_endpoint) AS source_endpoints,
  ARRAY_AGG(DISTINCT ingestion_run_id::text ORDER BY ingestion_run_id::text) AS ingestion_runs,
  'Provider-returned swap records only; not all Intents routes, settlement, or net flow.' AS coverage_note
FROM normalized_records
WHERE network = 'mainnet'
  AND record_type = 'intent_swap'
  AND occurred_at >= $1
  AND occurred_at < $2
GROUP BY source_id, utc_date
ORDER BY utc_date, source_id;

-- Metric lineage: source, both provider/collector timestamps, input fingerprint,
-- calculation version, and raw-data row count for each persisted observation.
SELECT metric_name, metric_value, unit, source_id, period_start, period_end,
       provider_observed_at, source_endpoint, observed_at, calculated_at,
       ingestion_run_id, input_record_count, input_sha256, calculation_name,
       calculation_version, dimensions, calculation_json
FROM metric_observations
WHERE observed_at >= $1 AND observed_at < $2
ORDER BY observed_at, metric_name, source_id;

-- Every source fetch observation, including repeats of an already normalized entity.
-- This table preserves per-run provenance when normalized_records keeps the latest entity view.
SELECT
  o.source_id,
  o.record_id,
  r.record_type,
  r.external_id,
  r.occurred_at,
  o.provider_observed_at,
  o.observed_at,
  o.ingestion_run_id,
  o.source_endpoint,
  o.payload_sha256,
  ir.status AS ingestion_status,
  ir.http_status,
  ir.completed_at AS run_completed_at,
  ir.response_sha256
FROM normalized_record_observations AS o
JOIN normalized_records AS r USING (record_id)
JOIN ingestion_runs AS ir ON ir.run_id = o.ingestion_run_id
WHERE o.observed_at >= $1
  AND o.observed_at < $2
ORDER BY o.observed_at, o.source_id, o.record_id;
