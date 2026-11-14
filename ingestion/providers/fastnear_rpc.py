"""Minimal FastNEAR public RPC fallback for a finalized block observation only.

This path deliberately does not claim historical transaction coverage: the existing
NEAR SIGNAL app has a separately validated all-shard RPC transaction sampler.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..normalization import normalize_record, utc_timestamp
from .base import ProviderBatch, ProviderError

SOURCE_ID = 'fastnear-public-rpc'
PROVIDER = 'FastNEAR public mainnet RPC'
ENDPOINT = 'https://free.rpc.fastnear.com'
DOCS_URL = 'https://docs.near.org/api/rpc/block-chunk'


def source_definition() -> dict[str, Any]:
    return {
        'source_id': SOURCE_ID,
        'provider': PROVIDER,
        'endpoint': ENDPOINT,
        'docs_url': DOCS_URL,
        'terms_url': None,
        'auth_mode': 'none_on_existing_public_rpc_endpoint',
        'access_status': 'verified_read_only_public_rpc',
        'enabled': True,
        'notes': 'Fallback for one finalized-block observation only; no daily history or transaction/adoption series is inferred. Numeric shared request limit is unpublished.',
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def _integer(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if parsed >= 0 else None


def fetch_finalized_block(*, timeout: float = 15.0) -> ProviderBatch:
    started = _now()
    request_body = {'jsonrpc': '2.0', 'id': 'near-signal-fallback', 'method': 'block', 'params': {'finality': 'final'}}
    body_bytes = json.dumps(request_body, separators=(',', ':')).encode('utf-8')
    request = Request(ENDPOINT, data=body_bytes,
                      headers={'Accept': 'application/json', 'Content-Type': 'application/json'}, method='POST')
    try:
        response = urlopen(request, timeout=timeout)
    except HTTPError as exc:
        raise ProviderError(SOURCE_ID, f'FastNEAR RPC HTTP {exc.code}', http_status=exc.code) from None
    except (URLError, TimeoutError, OSError) as exc:
        raise ProviderError(SOURCE_ID, f'FastNEAR RPC request failed: {type(exc).__name__}') from None
    with response:
        raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ProviderError(SOURCE_ID, 'FastNEAR RPC block response exceeded 8 MiB', http_status=response.status)
        try:
            envelope = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ProviderError(SOURCE_ID, 'FastNEAR RPC returned non-JSON response', http_status=response.status) from None
        if envelope.get('error'):
            error = envelope['error']
            raise ProviderError(SOURCE_ID, f"FastNEAR RPC error: {error.get('message', 'unspecified RPC error')}", http_status=response.status)
        block = envelope.get('result')
        header = block.get('header') if isinstance(block, dict) else None
        chunks = block.get('chunks') if isinstance(block, dict) else None
        if not isinstance(header, dict) or not isinstance(chunks, list):
            raise ProviderError(SOURCE_ID, 'FastNEAR RPC returned no usable finalized block', http_status=response.status)
        height = _integer(header.get('height'))
        block_hash = header.get('hash')
        provider_time = utc_timestamp(header.get('timestamp'))
        if height is None or not isinstance(block_hash, str) or not block_hash or not provider_time:
            raise ProviderError(SOURCE_ID, 'FastNEAR RPC returned an incomplete block header', http_status=response.status)
        fetched = _now()
        gas_used = [_integer(chunk.get('gas_used')) for chunk in chunks if isinstance(chunk, dict)]
        gas_limits = [_integer(chunk.get('gas_limit')) for chunk in chunks if isinstance(chunk, dict)]
        evidence = {
            'block_header': {key: header.get(key) for key in ('height', 'hash', 'timestamp', 'gas_price', 'epoch_id', 'latest_protocol_version')},
            'chunk_summaries': [
                {key: chunk.get(key) for key in ('shard_id', 'chunk_hash', 'height_created', 'height_included', 'gas_used', 'gas_limit')}
                for chunk in chunks if isinstance(chunk, dict)
            ],
        }
        fields: dict[str, Any] = {
            'block_height': height,
            'block_hash': block_hash,
            'dimensions': {'shard_count': len(chunks), 'transaction_count': None, 'fallback_scope': 'block_only'},
        }
        if len(gas_used) == len(chunks) and all(value is not None for value in gas_used):
            fields['gas_used_raw'] = str(sum(gas_used))
        if len(gas_limits) == len(chunks) and all(value is not None for value in gas_limits):
            fields['gas_limit_raw'] = str(sum(gas_limits))
        if header.get('gas_price') is not None:
            fields['gas_price_raw'] = str(header['gas_price'])
        record = normalize_record(
            record_type='block', source_id=SOURCE_ID, source_endpoint=ENDPOINT,
            observed_at=fetched, occurred_at=provider_time, provider_observed_at=provider_time,
            external_id=f'{height}:{block_hash}', fields=fields, payload=evidence,
        )
        return ProviderBatch(
            source_id=SOURCE_ID, provider=PROVIDER, request_url=ENDPOINT, final_url=ENDPOINT,
            started_at=started, fetched_at=fetched, http_status=response.status,
            provider_observed_at=provider_time, response_sha256=hashlib.sha256(raw).hexdigest(),
            records=[record], completeness='fallback_block_only',
            warnings=['Neardata was unavailable; this FastNEAR RPC response contains one finalized block only, not transaction history or a daily activity series.'],
            request_metadata={'method': 'POST', 'rpc_method': 'block', 'finality': 'final', 'auth': 'none'},
        )


def fetch_latest_with_fallback(*, timeout: float = 20.0) -> ProviderBatch:
    from .neardata import fetch_latest_finalized
    try:
        return fetch_latest_finalized(timeout=timeout)
    except ProviderError as primary_error:
        fallback = fetch_finalized_block(timeout=timeout)
        return replace(fallback, warnings=[f'Neardata failed ({primary_error}); switched to the verified FastNEAR public RPC block-only fallback.'] + fallback.warnings)
