"""Transactional orchestration for provider fetches and PostgreSQL provenance."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from .catalog import get_source_definition
from .postgres_store import (complete_run, ensure_database_storage_budget, register_source,
                             start_run, persist_records, persist_metric)
from .providers.base import ProviderBatch, ProviderError


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def _persist_observed_metrics(connection, run_id, records) -> int:
    """Persist metrics explicitly labelled observed-only, with input/source lineage."""
    from .calculations import build_metric_observations
    calculated_at = now_utc()
    observations = build_metric_observations(records, calculated_at=calculated_at)
    for observation in observations:
        persist_metric(
            connection,
            run_id=run_id,
            observation=observation,
            calculated_at=calculated_at,
            input_record_count=observation['input_record_count'],
            calculation_name=observation['calculation_name'],
            calculation_version=observation['calculation_version'],
            calculation_json=observation['calculation_json'],
        )
    return len(observations)


def persist_batch(connection, batch: ProviderBatch, *, request_metadata: dict[str, Any] | None = None,
                  derive_observed_metrics: bool = False) -> dict[str, Any]:
    """Persist a successfully fetched batch in one DB transaction, idempotently."""
    definition = get_source_definition(batch.source_id)
    run_id = uuid4()
    try:
        register_source(connection, definition)
        start_run(connection, run_id=run_id, source_id=batch.source_id, started_at=batch.started_at,
                  endpoint=batch.request_url,
                  request_metadata={**batch.request_metadata, **(request_metadata or {})})
        inserted = persist_records(connection, run_id=run_id, records=batch.records)
        metric_count = _persist_observed_metrics(connection, run_id, batch.records) if derive_observed_metrics else 0
        status = 'partial' if batch.warnings or batch.completeness != 'complete_for_returned_block_chunks' else 'succeeded'
        complete_run(connection, run_id, status=status, completed_at=batch.fetched_at,
                     http_status=batch.http_status, provider_observed_at=batch.provider_observed_at,
                     record_count=inserted, response_sha256=batch.response_sha256)
        connection.commit()
        return {'run_id': str(run_id), 'status': status, 'records': inserted, 'metrics': metric_count}
    except Exception:
        connection.rollback()
        raise


def run_with_persistence(connection, source_id: str, request_url: str,
                         fetch: Callable[[], ProviderBatch], *,
                         request_metadata: dict[str, Any] | None = None,
                         derive_observed_metrics: bool = False) -> tuple[ProviderBatch, dict[str, Any]]:
    """Record both successful and failed attempts when a database is configured."""
    ensure_database_storage_budget(connection)
    definition = get_source_definition(source_id)
    run_id = uuid4()
    started = now_utc()
    register_source(connection, definition)
    start_run(connection, run_id=run_id, source_id=source_id, started_at=started,
              endpoint=request_url, request_metadata=request_metadata or {})
    try:
        batch = fetch()
    except ProviderError as exc:
        error_source = exc.source_id if exc.source_id != source_id else source_id
        if error_source != source_id:
            register_source(connection, get_source_definition(error_source))
            connection.execute('UPDATE ingestion_runs SET source_id=%s WHERE run_id=%s', (error_source, run_id))
        complete_run(connection, run_id, status='failed', completed_at=now_utc(),
                     http_status=exc.http_status, record_count=0,
                     error_code='provider_error', error_message=str(exc))
        ensure_database_storage_budget(connection)
        connection.commit()
        raise
    try:
        if batch.source_id != source_id:
            # A fallback is a distinct data source. Repoint this run before writing
            # normalized rows so source_id and the run's provenance agree.
            fallback_definition = get_source_definition(batch.source_id)
            register_source(connection, fallback_definition)
            connection.execute('UPDATE ingestion_runs SET source_id=%s WHERE run_id=%s', (batch.source_id, run_id))
        inserted = persist_records(connection, run_id=run_id, records=batch.records)
        metric_count = _persist_observed_metrics(connection, run_id, batch.records) if derive_observed_metrics else 0
        status = 'partial' if batch.warnings or batch.completeness != 'complete_for_returned_block_chunks' else 'succeeded'
        complete_run(connection, run_id, status=status, completed_at=batch.fetched_at,
                     http_status=batch.http_status, provider_observed_at=batch.provider_observed_at,
                     record_count=inserted, response_sha256=batch.response_sha256)
        ensure_database_storage_budget(connection)
        connection.commit()
        return batch, {'run_id': str(run_id), 'status': status, 'records': inserted, 'metrics': metric_count}
    except Exception:
        connection.rollback()
        raise
