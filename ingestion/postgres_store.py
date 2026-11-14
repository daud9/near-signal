"""Optional PostgreSQL persistence adapter for NEAR SIGNAL.

Install psycopg separately (see requirements.txt) and configure
NEAR_SIGNAL_DATABASE_URL in the server environment. Credentials are never logged.
"""
from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
from typing import Any, Mapping, Sequence
from uuid import UUID, uuid4

from .normalization import sha256_json

SCHEMA_PATH = Path(__file__).resolve().parents[1] / 'sql' / 'postgres-schema.sql'
FREE_TIER_DATABASE_HARD_STOP_BYTES = 800 * 1024 * 1024


def connect(database_url: str | None = None):
    dsn = database_url or os.environ.get('NEAR_SIGNAL_DATABASE_URL')
    if not dsn:
        raise RuntimeError('NEAR_SIGNAL_DATABASE_URL is not configured; no external database was accessed')
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError('PostgreSQL driver missing; install ingestion/requirements.txt') from exc
    return psycopg.connect(dsn)


def ensure_database_storage_budget(connection, *, max_bytes: int | None = None) -> int:
    """Fail closed before writes when this database nears the configured Free cap.

    The application stops at 800 MiB by default, leaving headroom below Neon's
    1 GB/project Free storage limit. The cap may be lowered, never raised.
    """
    raw_limit = max_bytes if max_bytes is not None else os.environ.get(
        'NEAR_SIGNAL_MAX_DATABASE_BYTES', str(FREE_TIER_DATABASE_HARD_STOP_BYTES)
    )
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        raise RuntimeError('NEAR_SIGNAL_MAX_DATABASE_BYTES must be a positive integer; persistence refused') from None
    if limit < 1 or limit > FREE_TIER_DATABASE_HARD_STOP_BYTES:
        raise RuntimeError(
            f'database storage stop must be between 1 and {FREE_TIER_DATABASE_HARD_STOP_BYTES} bytes; persistence refused'
        )
    try:
        row = connection.execute('SELECT pg_database_size(current_database())').fetchone()
        size = int(row[0]) if row and row[0] is not None else None
    except Exception:
        raise RuntimeError('Could not verify database size; persistence refused') from None
    if size is None or size < 0:
        raise RuntimeError('Database size check returned no usable value; persistence refused')
    if size >= limit:
        raise RuntimeError(
            f'Database size {size} bytes reached the configured {limit}-byte stop; no data was persisted'
        )
    return size


def initialize_schema(connection) -> None:
    """Apply the checked-in idempotent PostgreSQL DDL on a caller-selected database."""
    ensure_database_storage_budget(connection)
    try:
        connection.execute(SCHEMA_PATH.read_text(encoding='utf-8'))
        ensure_database_storage_budget(connection)
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str)


def _timestamp(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value)
    return datetime.fromisoformat(text[:-1] + '+00:00' if text.endswith('Z') else text)


def register_source(connection, definition: Mapping[str, Any]) -> None:
    connection.execute(
        """INSERT INTO ingestion_sources
             (source_id, provider, endpoint, docs_url, terms_url, auth_mode, access_status,
              rate_limit_note, historical_coverage, enabled, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (source_id) DO UPDATE SET
             provider=EXCLUDED.provider, endpoint=EXCLUDED.endpoint, docs_url=EXCLUDED.docs_url,
             terms_url=EXCLUDED.terms_url, auth_mode=EXCLUDED.auth_mode,
             access_status=EXCLUDED.access_status, rate_limit_note=EXCLUDED.rate_limit_note,
             historical_coverage=EXCLUDED.historical_coverage, enabled=EXCLUDED.enabled,
             notes=EXCLUDED.notes, updated_at=now()""",
        (
            definition['source_id'], definition['provider'], definition['endpoint'],
            definition.get('docs_url'), definition.get('terms_url'), definition.get('auth_mode', 'none'),
            definition.get('access_status', 'unverified'), definition.get('rate_limit_note', 'Unknown'),
            definition.get('historical_coverage', 'Unknown'), bool(definition.get('enabled', False)),
            definition.get('notes'),
        ),
    )


def start_run(connection, *, run_id: UUID | None, source_id: str, started_at: Any,
              endpoint: str, request_metadata: Mapping[str, Any] | None = None) -> UUID:
    identifier = run_id or uuid4()
    connection.execute(
        """INSERT INTO ingestion_runs
             (run_id, source_id, status, started_at, source_endpoint, request_metadata)
           VALUES (%s, %s, 'running', %s, %s, %s::jsonb)""",
        (identifier, source_id, _timestamp(started_at), endpoint, _json(request_metadata or {})),
    )
    return identifier


def complete_run(connection, run_id: UUID, *, status: str, completed_at: Any,
                  http_status: int | None, provider_observed_at: Any = None,
                  record_count: int = 0, response_sha256: str | None = None,
                  error_code: str | None = None, error_message: str | None = None) -> None:
    connection.execute(
        """UPDATE ingestion_runs SET status=%s, completed_at=%s, http_status=%s,
             provider_observed_at=%s, record_count=%s, response_sha256=%s,
             error_code=%s, error_message=%s WHERE run_id=%s""",
        (status, _timestamp(completed_at), http_status, _timestamp(provider_observed_at),
         record_count, response_sha256, error_code, error_message, run_id),
    )


_RECORD_INSERT = """INSERT INTO normalized_records (
  record_id, network, record_type, source_id, ingestion_run_id, source_endpoint,
  external_id, occurred_at, provider_observed_at, observed_at, block_height,
  block_hash, transaction_hash, signer_account_id, receiver_account_id, account_id,
  contract_id, event_standard, event_name, status, amount_raw, amount_asset,
  dimensions, payload_json, payload_sha256
) VALUES (
  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
  %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s
) ON CONFLICT (record_id) DO UPDATE SET
  ingestion_run_id=EXCLUDED.ingestion_run_id, source_endpoint=EXCLUDED.source_endpoint,
  occurred_at=EXCLUDED.occurred_at, provider_observed_at=EXCLUDED.provider_observed_at,
  observed_at=EXCLUDED.observed_at, block_height=EXCLUDED.block_height,
  block_hash=EXCLUDED.block_hash, transaction_hash=EXCLUDED.transaction_hash,
  signer_account_id=EXCLUDED.signer_account_id, receiver_account_id=EXCLUDED.receiver_account_id,
  account_id=EXCLUDED.account_id, contract_id=EXCLUDED.contract_id,
  event_standard=EXCLUDED.event_standard, event_name=EXCLUDED.event_name,
  status=EXCLUDED.status, amount_raw=EXCLUDED.amount_raw, amount_asset=EXCLUDED.amount_asset,
  dimensions=EXCLUDED.dimensions, payload_json=EXCLUDED.payload_json,
  payload_sha256=EXCLUDED.payload_sha256"""


def persist_records(connection, *, run_id: UUID, records: Sequence[Any], network: str = 'mainnet') -> int:
    count = 0
    for record in records:
        item = record.as_dict() if hasattr(record, 'as_dict') else dict(record)
        fields = item.get('fields') or {}
        connection.execute(
            _RECORD_INSERT,
            (
                item['record_id'], network, item['record_type'], item['source_id'], run_id,
                item['source_endpoint'], item['external_id'], _timestamp(item.get('occurred_at')),
                _timestamp(item.get('provider_observed_at')), _timestamp(item['observed_at']),
                fields.get('block_height'), fields.get('block_hash'), fields.get('transaction_hash'),
                fields.get('signer_account_id'), fields.get('receiver_account_id'), fields.get('account_id'),
                fields.get('contract_id'), fields.get('event_standard'), fields.get('event_name'),
                fields.get('status'), None if fields.get('amount_raw') is None else str(fields.get('amount_raw')),
                fields.get('amount_asset'), _json(fields.get('dimensions') or {}),
                _json(item.get('payload')), item['payload_sha256'],
            ),
        )
        observation_id = sha256_json({'record_id': item['record_id'], 'ingestion_run_id': str(run_id)})
        connection.execute(
            """INSERT INTO normalized_record_observations (
                 observation_id, record_id, ingestion_run_id, source_id, record_type,
                 source_endpoint, external_id, occurred_at, provider_observed_at,
                 observed_at, payload_sha256, payload_json
               ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
               ON CONFLICT (observation_id) DO NOTHING""",
            (
                observation_id, item['record_id'], run_id, item['source_id'], item['record_type'],
                item['source_endpoint'], item['external_id'], _timestamp(item.get('occurred_at')),
                _timestamp(item.get('provider_observed_at')), _timestamp(item['observed_at']),
                item['payload_sha256'], _json(item.get('payload')),
            ),
        )
        count += 1
    return count


def persist_metric(connection, *, run_id: UUID | None, observation: Mapping[str, Any],
                   calculated_at: Any, input_record_count: int, calculation_name: str,
                   calculation_version: str, calculation_json: Mapping[str, Any] | None = None) -> None:
    connection.execute(
        """INSERT INTO metric_observations (
             observation_id, metric_name, metric_value, unit, source_id, source_endpoint,
             period_start, period_end, provider_observed_at, observed_at, calculated_at,
             ingestion_run_id, input_record_count, input_sha256, calculation_name,
             calculation_version, dimensions, calculation_json
           ) VALUES (
             %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
             %s::jsonb, %s::jsonb
           ) ON CONFLICT (observation_id) DO UPDATE SET
             metric_value=EXCLUDED.metric_value, unit=EXCLUDED.unit,
             source_endpoint=EXCLUDED.source_endpoint, period_start=EXCLUDED.period_start,
             period_end=EXCLUDED.period_end, provider_observed_at=EXCLUDED.provider_observed_at,
             observed_at=EXCLUDED.observed_at,
             calculated_at=EXCLUDED.calculated_at, ingestion_run_id=EXCLUDED.ingestion_run_id,
             input_record_count=EXCLUDED.input_record_count, input_sha256=EXCLUDED.input_sha256,
             calculation_name=EXCLUDED.calculation_name,
             calculation_version=EXCLUDED.calculation_version,
             dimensions=EXCLUDED.dimensions, calculation_json=EXCLUDED.calculation_json""",
        (
            observation['observation_id'], observation['metric_name'], observation['metric_value'],
            observation['unit'], observation['source_id'], observation['source_endpoint'],
            _timestamp(observation.get('period_start')), _timestamp(observation.get('period_end')),
            _timestamp(observation.get('provider_observed_at')), _timestamp(observation['observed_at']),
            _timestamp(calculated_at), run_id, input_record_count, observation['input_sha256'],
            calculation_name, calculation_version, _json(observation.get('dimensions') or {}),
            _json(calculation_json or {}),
        ),
    )
