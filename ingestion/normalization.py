"""Provider-neutral normalization and provenance helpers for NEAR SIGNAL.

Provider adapters must map only fields actually returned by a source. No defaults
are invented for unknown measurements. This module has no network or DB side effects.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
from typing import Any, Mapping
from urllib.parse import urlparse


def utc_timestamp(value: Any) -> str | None:
    """Normalize ISO timestamps, Unix seconds/milliseconds, and NEAR nanoseconds."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    elif isinstance(value, (int, float, Decimal)) or (isinstance(value, str) and value.strip().lstrip('-').isdigit()):
        try:
            numeric = Decimal(str(value))
            if not numeric.is_finite() or numeric <= 0:
                return None
            if numeric > Decimal('1e15'):
                numeric /= Decimal('1e9')  # nanoseconds -> seconds
            elif numeric > Decimal('1e12'):
                numeric /= Decimal('1e3')  # milliseconds -> seconds
            seconds = float(numeric)
            if not math.isfinite(seconds):
                return None
            parsed = datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (InvalidOperation, OverflowError, OSError, ValueError):
            return None
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text[:-1] + '+00:00' if text.endswith(('Z', 'z')) else text)
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str)


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()


def _require_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.netloc:
        raise ValueError('source endpoint must be an HTTPS URL')


@dataclass(frozen=True)
class NormalizedRecord:
    record_id: str
    record_type: str
    source_id: str
    source_endpoint: str
    observed_at: str
    provider_observed_at: str | None
    occurred_at: str | None
    external_id: str | None
    fields: dict[str, Any]
    payload: Any
    payload_sha256: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def normalize_record(
    *,
    record_type: str,
    source_id: str,
    source_endpoint: str,
    observed_at: Any,
    fields: Mapping[str, Any],
    payload: Any,
    occurred_at: Any = None,
    provider_observed_at: Any = None,
    external_id: str | None = None,
) -> NormalizedRecord:
    """Build a source-linked entity and hash the compact evidence supplied by its adapter."""
    if record_type not in {'block', 'transaction', 'account_snapshot', 'event', 'intent_swap'}:
        raise ValueError(f'unsupported normalized record type: {record_type}')
    if not source_id or not isinstance(source_id, str):
        raise ValueError('source_id is required')
    _require_http_url(source_endpoint)
    observed = utc_timestamp(observed_at)
    if observed is None:
        raise ValueError('observed_at must be a valid timestamp')
    provider_time = utc_timestamp(provider_observed_at)
    occurred = utc_timestamp(occurred_at)
    normalized_fields = {str(key): value for key, value in fields.items() if value is not None}
    payload_hash = sha256_json(payload)
    identity = external_id or sha256_json({
        'source_id': source_id,
        'record_type': record_type,
        'occurred_at': occurred,
        'fields': normalized_fields,
        'payload_sha256': payload_hash,
    })
    record_id = sha256_json({'source_id': source_id, 'record_type': record_type, 'external_id': identity})
    return NormalizedRecord(
        record_id=record_id,
        record_type=record_type,
        source_id=source_id,
        source_endpoint=source_endpoint,
        observed_at=observed,
        provider_observed_at=provider_time,
        occurred_at=occurred,
        external_id=identity,
        fields=normalized_fields,
        payload=payload,
        payload_sha256=payload_hash,
    )


def normalize_metric(
    *,
    metric_name: str,
    value: Any,
    unit: str,
    source_id: str,
    source_endpoint: str,
    observed_at: Any,
    provider_observed_at: Any = None,
    period_start: Any = None,
    period_end: Any = None,
    dimensions: Mapping[str, Any] | None = None,
    input_fingerprint: str | None = None,
) -> dict[str, Any]:
    """Normalize a measured/calculated metric; missing/non-finite values are rejected."""
    if value is None or isinstance(value, bool):
        raise ValueError('metric value is unavailable; do not store it as zero')
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError('metric value must be numeric') from None
    if not number.is_finite():
        raise ValueError('metric value must be finite')
    if not metric_name or not unit or not source_id:
        raise ValueError('metric_name, unit, and source_id are required')
    _require_http_url(source_endpoint)
    observed = utc_timestamp(observed_at)
    if observed is None:
        raise ValueError('observed_at must be a valid timestamp')
    provider_time = utc_timestamp(provider_observed_at)
    start = utc_timestamp(period_start)
    end = utc_timestamp(period_end)
    dims = dict(dimensions or {})
    fingerprint = input_fingerprint or sha256_json({'metric_name': metric_name, 'value': str(number), 'dimensions': dims})
    identity = sha256_json({
        'metric_name': metric_name,
        'source_id': source_id,
        'period_start': start,
        'period_end': end,
        'dimensions': dims,
        'input_fingerprint': fingerprint,
    })
    return {
        'observation_id': identity,
        'metric_name': metric_name,
        'metric_value': str(number),
        'unit': unit,
        'source_id': source_id,
        'source_endpoint': source_endpoint,
        'period_start': start,
        'period_end': end,
        'provider_observed_at': provider_time,
        'observed_at': observed,
        'input_sha256': fingerprint,
        'dimensions': dims,
    }
