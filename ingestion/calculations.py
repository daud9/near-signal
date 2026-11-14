"""Reproducible, provider-scoped calculations over normalized records.

Value calculations use observed rows only. They do not calendar-fill missing dates,
interpret wallet addresses as people, combine duplicate providers, or add token amounts.
Metric envelopes retain input hashes, provenance timestamps, endpoint scope and versions.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import hashlib
from typing import Any, Iterable, Mapping

try:
    from .normalization import canonical_json, normalize_metric, sha256_json, utc_timestamp
except ImportError:  # unittest discovery may place ingestion/ directly on sys.path.
    from normalization import canonical_json, normalize_metric, sha256_json, utc_timestamp

CALCULATION_VERSION = '1.2.0'


def _as_mapping(record: Any) -> Mapping[str, Any] | None:
    if hasattr(record, 'as_dict'):
        record = record.as_dict()
    return record if isinstance(record, Mapping) else None


def _record_parts(record: Any) -> tuple[str | None, str | None, dict[str, Any]]:
    record = _as_mapping(record)
    if record is None:
        return None, None, {}
    fields = record.get('fields')
    fields = dict(fields) if isinstance(fields, Mapping) else dict(record)
    # Canonical provenance fields are set by the normalizer; mirror only values
    # actually supplied and never replace a provider-provided field.
    for key in ('occurred_at', 'external_id', 'record_id', 'payload_sha256', 'dimensions'):
        if fields.get(key) is None and record.get(key) is not None:
            fields[key] = record[key]
    return record.get('source_id'), record.get('record_type') or record.get('kind'), fields


def _date(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).date().isoformat()
    except ValueError:
        if len(value) == 10:
            try:
                return datetime.strptime(value, '%Y-%m-%d').date().isoformat()
            except ValueError:
                return None
        return None


def _observed_rows(records: Iterable[Any], required_type: str):
    for record in records:
        source_id, kind, fields = _record_parts(record)
        if source_id and kind == required_type:
            yield source_id, fields


def daily_activity(records: Iterable[Any]) -> list[dict[str, Any]]:
    """Return observed transaction/signer counts per UTC day and provider."""
    groups: dict[tuple[str, str], dict[str, Any]] = defaultdict(lambda: {
        'transaction_ids': set(), 'signers': set(), 'missing_signer_rows': 0,
        'input_record_count': 0,
    })
    for source_id, fields in _observed_rows(records, 'transaction'):
        day = _date(fields.get('occurred_at') or fields.get('block_timestamp'))
        transaction_id = fields.get('transaction_hash') or fields.get('external_id')
        if not day or not transaction_id:
            continue
        group = groups[(source_id, day)]
        group['transaction_ids'].add(str(transaction_id))
        group['input_record_count'] += 1
        signer = fields.get('signer_account_id')
        if signer:
            group['signers'].add(str(signer))
        else:
            group['missing_signer_rows'] += 1
    return [
        {
            'source_id': source,
            'date': day,
            'transaction_count': len(group['transaction_ids']),
            'active_signer_accounts': len(group['signers']) if group['missing_signer_rows'] == 0 else None,
            'input_record_count': group['input_record_count'],
            'missing_signer_rows': group['missing_signer_rows'],
            'coverage_note': 'Observed records only; source pagination/completeness is not implied.',
            'calculation': 'distinct transaction_hash and distinct signer_account_id by UTC date and source',
            'calculation_version': CALCULATION_VERSION,
        }
        for (source, day), group in sorted(groups.items())
    ]


def daily_contract_activity(records: Iterable[Any]) -> list[dict[str, Any]]:
    """Count observed top-level transaction FunctionCall actions by contract/day."""
    groups: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(lambda: {
        'transaction_ids': set(), 'signers': set(), 'missing_signer_rows': 0,
    })
    for source_id, fields in _observed_rows(records, 'transaction'):
        day = _date(fields.get('occurred_at') or fields.get('block_timestamp'))
        transaction_id = fields.get('transaction_hash') or fields.get('external_id')
        contract = fields.get('contract_id')
        dimensions = fields.get('dimensions') if isinstance(fields.get('dimensions'), Mapping) else {}
        action_types = dimensions.get('action_types') if isinstance(dimensions, Mapping) else []
        if not day or not transaction_id or not contract or 'FunctionCall' not in (action_types or []):
            continue
        group = groups[(source_id, day, str(contract))]
        group['transaction_ids'].add(str(transaction_id))
        signer = fields.get('signer_account_id')
        if signer:
            group['signers'].add(str(signer))
        else:
            group['missing_signer_rows'] += 1
    return [
        {
            'source_id': source,
            'date': day,
            'contract_id': contract,
            'function_call_transaction_count': len(group['transaction_ids']),
            'signer_account_count': len(group['signers']) if group['missing_signer_rows'] == 0 else None,
            'missing_signer_rows': group['missing_signer_rows'],
            'coverage_note': 'Top-level transaction FunctionCall actions only; receipt-generated calls are not included.',
            'calculation': 'distinct transaction_hash and signer_account_id by UTC date, provider, and contract',
            'calculation_version': CALCULATION_VERSION,
        }
        for (source, day, contract), group in sorted(groups.items())
    ]


def daily_event_counts(records: Iterable[Any]) -> list[dict[str, Any]]:
    """Count normalized decoded event records by day/provider/contract/standard/name."""
    groups: dict[tuple[str, str, str | None, str | None, str | None], set[str]] = defaultdict(set)
    for source_id, fields in _observed_rows(records, 'event'):
        day = _date(fields.get('occurred_at') or fields.get('block_timestamp'))
        event_id = fields.get('external_id') or fields.get('event_id') or fields.get('transaction_hash')
        if not day or not event_id:
            continue
        key = (source_id, day, fields.get('contract_id'), fields.get('event_standard'), fields.get('event_name'))
        groups[key].add(str(event_id))
    return [
        {
            'source_id': source,
            'date': day,
            'contract_id': contract,
            'event_standard': standard,
            'event_name': name,
            'event_count': len(event_ids),
            'coverage_note': 'Observed decoded event records only; missing provider history is not zero.',
            'calculation': 'distinct source event identifiers by UTC date, provider, contract, standard, and event name',
            'calculation_version': CALCULATION_VERSION,
        }
        for (source, day, contract, standard, name), event_ids in sorted(groups.items(), key=lambda item: tuple('' if x is None else str(x) for x in item[0]))
    ]


def daily_intent_swap_counts(records: Iterable[Any]) -> list[dict[str, Any]]:
    """Count only recorded 1Click/intent swap records; does not claim net flow or value."""
    groups: dict[tuple[str, str], set[str]] = defaultdict(set)
    for source_id, fields in _observed_rows(records, 'intent_swap'):
        day = _date(fields.get('occurred_at') or fields.get('created_at') or fields.get('block_timestamp'))
        record_id = fields.get('external_id') or fields.get('swap_id') or fields.get('intent_id')
        if not day or not record_id:
            continue
        groups[(source_id, day)].add(str(record_id))
    return [
        {
            'source_id': source,
            'date': day,
            'swap_record_count': len(record_ids),
            'coverage_note': 'Provider-returned swap records only; not all Intents routes, settled net flow, or USD volume.',
            'calculation': 'distinct source swap identifiers by UTC date and provider',
            'calculation_version': CALCULATION_VERSION,
        }
        for (source, day), record_ids in sorted(groups.items())
    ]


def _day_inputs(records: list[Any], source_id: str, day: str, record_type: str,
                predicate=None) -> list[Mapping[str, Any]]:
    selected = []
    for raw in records:
        row = _as_mapping(raw)
        if row is None or row.get('source_id') != source_id or row.get('record_type') != record_type:
            continue
        _, _, fields = _record_parts(row)
        timestamp = fields.get('occurred_at') or fields.get('block_timestamp') or fields.get('created_at')
        if _date(timestamp) != day or (predicate and not predicate(fields)):
            continue
        selected.append(row)
    # Stable record IDs make retries and duplicate input rows idempotent.
    unique = {}
    for row in selected:
        key = row.get('record_id') or row.get('external_id') or (row.get('fields') or {}).get('transaction_hash')
        if key is None:
            key = sha256_json(row)
        unique[str(key)] = row
    return [unique[key] for key in sorted(unique)]


def _metric_envelope(*, records: list[Any], source_id: str, day: str, metric_name: str,
                     value: Any, unit: str, calculated_at: str, dimensions: Mapping[str, Any],
                     calculation_name: str, coverage_note: str) -> dict[str, Any] | None:
    if value is None or not records:
        return None
    primary_endpoint = None
    endpoint_examples = []
    sampled_endpoints = set()
    latest_observed_at = None
    latest_provider_time = None
    input_digest = hashlib.sha256()
    input_record_id_sample = []
    incomplete_provenance = False
    for row in records:
        _, _, fields = _record_parts(row)
        endpoint = row.get('source_endpoint')
        if endpoint:
            endpoint = str(endpoint)
            if primary_endpoint is None:
                primary_endpoint = endpoint
            if endpoint not in sampled_endpoints and len(endpoint_examples) < 5:
                sampled_endpoints.add(endpoint)
                endpoint_examples.append(endpoint)
        else:
            incomplete_provenance = True
        observed_time = row.get('observed_at')
        if observed_time:
            if latest_observed_at is None or str(observed_time) > latest_observed_at:
                latest_observed_at = str(observed_time)
        else:
            incomplete_provenance = True
        provider_time = row.get('provider_observed_at') or row.get('occurred_at') or fields.get('occurred_at')
        if provider_time and (latest_provider_time is None or str(provider_time) > latest_provider_time):
            latest_provider_time = str(provider_time)
        record_id = row.get('record_id')
        payload_hash = row.get('payload_sha256')
        if not record_id or not payload_hash or len(str(payload_hash)) != 64:
            incomplete_provenance = True
        input_key = {
            'record_id': record_id,
            'payload_sha256': payload_hash,
            'source_endpoint': endpoint,
        }
        input_digest.update(canonical_json(input_key).encode('utf-8'))
        input_digest.update(b'\n')
        if len(input_record_id_sample) < 20:
            input_record_id_sample.append(record_id)
    # Without a source endpoint and collector time, provenance is insufficient to
    # persist a derived metric. Do not fabricate either timestamp or a URL.
    if incomplete_provenance or not primary_endpoint or not latest_observed_at:
        return None
    input_fingerprint = input_digest.hexdigest()
    period_start = f'{day}T00:00:00Z'
    period_end = f'{(date.fromisoformat(day) + timedelta(days=1)).isoformat()}T00:00:00Z'
    metric_dimensions = dict(dimensions)
    metric_dimensions['source_endpoint_examples'] = endpoint_examples
    normalized = normalize_metric(
        metric_name=metric_name,
        value=value,
        unit=unit,
        source_id=source_id,
        source_endpoint=primary_endpoint,
        observed_at=latest_observed_at,
        provider_observed_at=latest_provider_time,
        period_start=period_start,
        period_end=period_end,
        dimensions=metric_dimensions,
        input_fingerprint=input_fingerprint,
    )
    normalized['observation_id'] = sha256_json({
        'normalized_observation_id': normalized['observation_id'],
        'calculation_name': calculation_name,
        'calculation_version': CALCULATION_VERSION,
    })
    normalized.update({
        'calculated_at': calculated_at,
        'input_record_count': len(records),
        'calculation_name': calculation_name,
        'calculation_version': CALCULATION_VERSION,
        'calculation_json': {
            'coverage_note': coverage_note,
            'input_record_count': len(records),
            'input_sha256': input_fingerprint,
            'source_endpoint_examples': endpoint_examples,
            'input_record_id_sample': input_record_id_sample,
            'input_record_ids_truncated': len(records) > len(input_record_id_sample),
            'input_fingerprint_method': 'SHA-256 of newline-delimited canonical {record_id,payload_sha256,source_endpoint} objects in stable record-ID order',
        },
    })
    return normalized


def build_metric_observations(records: Iterable[Any], *, calculated_at: str | None = None) -> list[dict[str, Any]]:
    """Build fully-provenanced daily metric rows from records actually present.

    This function produces observed-sample metrics, not complete-day network totals.
    Missing signer values, missing endpoint/time provenance, and missing dates produce
    no corresponding metric row. `calculated_at` may be fixed for deterministic replay.
    """
    materialized = list(records)
    candidate_time = calculated_at or datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    calc_time = utc_timestamp(candidate_time)
    if calc_time is None:
        raise ValueError('calculated_at must be a valid timestamp')
    observations: list[dict[str, Any]] = []

    for row in daily_activity(materialized):
        inputs = _day_inputs(materialized, row['source_id'], row['date'], 'transaction')
        common = {'source_id': row['source_id'], 'date': row['date']}
        tx_metric = _metric_envelope(
            records=inputs, source_id=row['source_id'], day=row['date'],
            metric_name='observed_transaction_count', value=row['transaction_count'], unit='transactions',
            calculated_at=calc_time, dimensions=common, calculation_name='daily_activity',
            coverage_note=row['coverage_note'],
        )
        if tx_metric:
            observations.append(tx_metric)
        signer_metric = _metric_envelope(
            records=inputs, source_id=row['source_id'], day=row['date'],
            metric_name='observed_distinct_signer_accounts', value=row['active_signer_accounts'], unit='account_ids',
            calculated_at=calc_time, dimensions=common, calculation_name='daily_activity',
            coverage_note=row['coverage_note'] + ' Signer values are addresses, not people.',
        )
        if signer_metric:
            signer_metric['calculation_json']['missing_signer_rows'] = row['missing_signer_rows']
            observations.append(signer_metric)

    for row in daily_contract_activity(materialized):
        def is_function_call(fields):
            dims = fields.get('dimensions') if isinstance(fields.get('dimensions'), Mapping) else {}
            return fields.get('contract_id') == row['contract_id'] and 'FunctionCall' in (dims.get('action_types') or [])
        inputs = _day_inputs(materialized, row['source_id'], row['date'], 'transaction', is_function_call)
        common = {'source_id': row['source_id'], 'date': row['date'], 'contract_id': row['contract_id']}
        contract_metric = _metric_envelope(
            records=inputs, source_id=row['source_id'], day=row['date'],
            metric_name='observed_function_call_transactions', value=row['function_call_transaction_count'], unit='transactions',
            calculated_at=calc_time, dimensions=common, calculation_name='daily_contract_activity',
            coverage_note=row['coverage_note'],
        )
        if contract_metric:
            observations.append(contract_metric)

    for row in daily_event_counts(materialized):
        def is_same_event(fields):
            return (fields.get('contract_id') == row['contract_id']
                    and fields.get('event_standard') == row['event_standard']
                    and fields.get('event_name') == row['event_name'])
        inputs = _day_inputs(materialized, row['source_id'], row['date'], 'event', is_same_event)
        event_metric = _metric_envelope(
            records=inputs, source_id=row['source_id'], day=row['date'],
            metric_name='observed_decoded_event_count', value=row['event_count'], unit='events',
            calculated_at=calc_time,
            dimensions={'source_id': row['source_id'], 'date': row['date'], 'contract_id': row['contract_id'],
                        'event_standard': row['event_standard'], 'event_name': row['event_name']},
            calculation_name='daily_event_counts', coverage_note=row['coverage_note'],
        )
        if event_metric:
            observations.append(event_metric)

    for row in daily_intent_swap_counts(materialized):
        inputs = _day_inputs(materialized, row['source_id'], row['date'], 'intent_swap')
        intent_metric = _metric_envelope(
            records=inputs, source_id=row['source_id'], day=row['date'],
            metric_name='observed_intent_swap_record_count', value=row['swap_record_count'], unit='swap_records',
            calculated_at=calc_time, dimensions={'source_id': row['source_id'], 'date': row['date']},
            calculation_name='daily_intent_swap_counts', coverage_note=row['coverage_note'],
        )
        if intent_metric:
            observations.append(intent_metric)

    return observations
