-- NEAR SIGNAL normalized data store (PostgreSQL 14+).
-- Idempotent DDL; run with psql against an explicitly configured database.
-- No provider credentials are stored here. Every row keeps source and observation provenance.

CREATE TABLE IF NOT EXISTS ingestion_sources (
  source_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  docs_url TEXT,
  terms_url TEXT,
  auth_mode TEXT NOT NULL DEFAULT 'none',
  access_status TEXT NOT NULL DEFAULT 'unverified',
  rate_limit_note TEXT NOT NULL DEFAULT 'Unknown',
  historical_coverage TEXT NOT NULL DEFAULT 'Unknown',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Additive migration for a database initialized from an earlier NEAR SIGNAL schema.
ALTER TABLE ingestion_sources ADD COLUMN IF NOT EXISTS rate_limit_note TEXT NOT NULL DEFAULT 'Unknown';
ALTER TABLE ingestion_sources ADD COLUMN IF NOT EXISTS historical_coverage TEXT NOT NULL DEFAULT 'Unknown';

CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id UUID PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'blocked')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  source_endpoint TEXT NOT NULL,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  http_status INTEGER,
  provider_observed_at TIMESTAMPTZ,
  record_count INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  response_sha256 TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX IF NOT EXISTS ingestion_runs_source_started_idx
  ON ingestion_runs (source_id, started_at DESC);

-- Standardized entity columns support reproducible SQL across providers; payload_json
-- contains compact source evidence supplied by the adapter (secrets/signatures and
-- large opaque arguments are omitted when not needed to reproduce normalized fields).
CREATE TABLE IF NOT EXISTS normalized_records (
  record_id TEXT PRIMARY KEY,
  network TEXT NOT NULL DEFAULT 'mainnet',
  record_type TEXT NOT NULL CHECK (record_type IN ('block', 'transaction', 'account_snapshot', 'event', 'intent_swap')),
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id),
  ingestion_run_id UUID NOT NULL REFERENCES ingestion_runs(run_id),
  source_endpoint TEXT NOT NULL,
  external_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  provider_observed_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  block_height BIGINT CHECK (block_height IS NULL OR block_height >= 0),
  block_hash TEXT,
  transaction_hash TEXT,
  signer_account_id TEXT,
  receiver_account_id TEXT,
  account_id TEXT,
  contract_id TEXT,
  event_standard TEXT,
  event_name TEXT,
  status TEXT,
  amount_raw TEXT,
  amount_asset TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_json JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, record_type, external_id)
);
CREATE INDEX IF NOT EXISTS normalized_records_type_time_idx
  ON normalized_records (network, record_type, occurred_at);
CREATE INDEX IF NOT EXISTS normalized_records_tx_signer_idx
  ON normalized_records (network, occurred_at, signer_account_id)
  WHERE record_type = 'transaction';
CREATE INDEX IF NOT EXISTS normalized_records_contract_event_idx
  ON normalized_records (network, occurred_at, contract_id, event_standard, event_name)
  WHERE record_type = 'event';
CREATE INDEX IF NOT EXISTS normalized_records_intent_time_idx
  ON normalized_records (network, occurred_at, source_id)
  WHERE record_type = 'intent_swap';
CREATE INDEX IF NOT EXISTS normalized_records_payload_gin_idx
  ON normalized_records USING GIN (dimensions);

-- Derived values are source-scoped observations. Exact retries are idempotent;
-- new input hashes or calculation versions create distinct observation IDs.
-- A NULL or unavailable metric is not inserted as zero; input hashes and method
-- versions make each result reproducible from normalized records.
CREATE TABLE IF NOT EXISTS metric_observations (
  observation_id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id),
  source_endpoint TEXT NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  provider_observed_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  ingestion_run_id UUID REFERENCES ingestion_runs(run_id),
  input_record_count INTEGER NOT NULL CHECK (input_record_count >= 0),
  input_sha256 TEXT NOT NULL,
  calculation_name TEXT NOT NULL,
  calculation_version TEXT NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS metric_observations_lookup_idx
  ON metric_observations (metric_name, source_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS metric_observations_period_idx
  ON metric_observations (metric_name, period_start, period_end);


-- Each fetch observation is retained even when normalized_records upserts the same
-- source entity on a later run. This preserves the response/run/timestamp history.
CREATE TABLE IF NOT EXISTS normalized_record_observations (
  observation_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES normalized_records(record_id),
  ingestion_run_id UUID NOT NULL REFERENCES ingestion_runs(run_id),
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id),
  record_type TEXT NOT NULL,
  source_endpoint TEXT NOT NULL,
  external_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  provider_observed_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ingestion_run_id, record_id)
);
CREATE INDEX IF NOT EXISTS record_observations_entity_time_idx
  ON normalized_record_observations (record_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS record_observations_run_idx
  ON normalized_record_observations (ingestion_run_id, source_id);
