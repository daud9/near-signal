"""Read-only NEAR mainnet block adapter for FastNEAR Neardata.

The public redirect endpoints and a block payload were tested 2026-11-14. This
adapter stores compact source evidence and refuses transaction rows when any
returned shard/chunk fails the source block's own hash/height checks.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from ..normalization import normalize_record, utc_timestamp
from .base import ProviderBatch, ProviderError

SOURCE_ID = 'neardata-mainnet'
PROVIDER = 'FastNEAR Neardata'
BASE_URL = 'https://mainnet.neardata.xyz'
LATEST_URL = f'{BASE_URL}/v0/last_block/final'
FIRST_URL = f'{BASE_URL}/v0/first_block'
DOCS_URL = 'https://docs.fastnear.com/neardata'
MAX_RESPONSE_BYTES = 32 * 1024 * 1024


def source_definition() -> dict[str, Any]:
    return {
        'source_id': SOURCE_ID,
        'provider': PROVIDER,
        'endpoint': LATEST_URL,
        'docs_url': DOCS_URL,
        'terms_url': None,
        'auth_mode': 'none_on_tested_public_block_cursor',
        'access_status': 'verified_read_only_public_endpoint',
        'enabled': True,
        'notes': 'Latest/first cursor and block read tested. No numeric request quota published; use conservative polling. Archive completeness beyond the observed first cursor is not guaranteed.',
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if parsed >= 0 else None


def _read_json(url: str, *, timeout: float = 20.0) -> tuple[dict[str, Any], int, str, str, str, str]:
    started_at = _now()
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'NEAR-SIGNAL read-only ingestion'}, method='GET')
    try:
        response = urlopen(request, timeout=timeout)
    except HTTPError as exc:
        raise ProviderError(SOURCE_ID, f'HTTP {exc.code} from Neardata', http_status=exc.code) from None
    except (URLError, TimeoutError, OSError) as exc:
        raise ProviderError(SOURCE_ID, f'Neardata request failed: {type(exc).__name__}') from None
    with response:
        content_length = response.headers.get('Content-Length')
        if content_length and content_length.isdigit() and int(content_length) > MAX_RESPONSE_BYTES:
            raise ProviderError(SOURCE_ID, f'Neardata response exceeded {MAX_RESPONSE_BYTES} bytes', http_status=response.status)
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ProviderError(SOURCE_ID, f'Neardata response exceeded {MAX_RESPONSE_BYTES} bytes', http_status=response.status)
        try:
            data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ProviderError(SOURCE_ID, 'Neardata returned non-JSON response', http_status=response.status) from None
        if not isinstance(data, dict):
            raise ProviderError(SOURCE_ID, 'Neardata returned an unexpected JSON shape', http_status=response.status)
        return data, response.status, response.geturl(), started_at, _now(), hashlib.sha256(body).hexdigest()


def _summaries(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[tuple[int, dict[str, Any]]], bool, list[str]]:
    block = payload.get('block')
    shards = payload.get('shards')
    if not isinstance(block, dict) or not isinstance(block.get('header'), dict) or not isinstance(block.get('chunks'), list) or not isinstance(shards, list):
        raise ProviderError(SOURCE_ID, 'Neardata block payload is missing block header, chunks, or shards')
    header = block['header']
    height = _positive_int(header.get('height'))
    block_hash = header.get('hash')
    block_time = utc_timestamp(header.get('timestamp_nanosec') or header.get('timestamp'))
    if height is None or not isinstance(block_hash, str) or not block_hash or not block_time:
        raise ProviderError(SOURCE_ID, 'Neardata returned a block without valid height, hash, or timestamp')
    complete = True
    warnings: list[str] = []
    by_shard: dict[int, dict[str, Any]] = {}
    for shard in shards:
        if not isinstance(shard, dict):
            complete = False
            warnings.append('Returned shard entry is malformed; full-block transaction count withheld.')
            continue
        returned_shard_id = _positive_int(shard.get('shard_id'))
        if returned_shard_id is None:
            complete = False
            warnings.append('Returned shard has no valid shard identifier; full-block transaction count withheld.')
            continue
        if returned_shard_id in by_shard:
            complete = False
            warnings.append(f'Duplicate returned shard identifier {returned_shard_id}; full-block transaction count withheld.')
            continue
        by_shard[returned_shard_id] = shard
    tx_rows: list[tuple[int, dict[str, Any]]] = []
    compact_chunks: list[dict[str, Any]] = []
    gas_used_parts: list[int] = []
    gas_limit_parts: list[int] = []
    seen_ref_shards: set[int] = set()

    for ref in block['chunks']:
        if not isinstance(ref, dict):
            complete = False
            warnings.append('Block contains a malformed chunk reference; transaction rows withheld.')
            continue
        shard_id = _positive_int(ref.get('shard_id'))
        height_included = _positive_int(ref.get('height_included'))
        chunk_hash = ref.get('chunk_hash')
        if shard_id is not None and shard_id in seen_ref_shards:
            complete = False
            warnings.append(f'Duplicate block shard reference {shard_id}; full-block transaction count withheld.')
            continue
        if shard_id is not None:
            seen_ref_shards.add(shard_id)
        shard = by_shard.get(shard_id)
        chunk = shard.get('chunk') if isinstance(shard, dict) else None
        chunk_header = chunk.get('header') if isinstance(chunk, dict) else None
        transactions = chunk.get('transactions') if isinstance(chunk, dict) else None
        if shard_id is None or height_included is None or height_included > height or not isinstance(chunk_hash, str) or not chunk_hash:
            complete = False
            warnings.append('Block contains an invalid shard reference; full-block transaction count withheld.')
        matches = bool(
            isinstance(chunk_header, dict)
            and chunk_header.get('chunk_hash') == chunk_hash
            and _positive_int(chunk_header.get('height_included')) == height_included
            and isinstance(transactions, list)
        )
        is_reused_prior_chunk = height_included is not None and height_included < height
        if is_reused_prior_chunk:
            # No new chunk was included in this block for this shard; any older
            # chunk body must not be counted again as this block's transactions.
            matches = False
        elif not matches:
            complete = False
            warnings.append('At least one shard chunk is missing or mismatched; all transaction rows and full-block transaction count were withheld.')
        gas_used = _positive_int(ref.get('gas_used'))
        gas_limit = _positive_int(ref.get('gas_limit'))
        if gas_used is None:
            gas_used_parts.append(-1)
        else:
            gas_used_parts.append(gas_used)
        if gas_limit is None:
            gas_limit_parts.append(-1)
        else:
            gas_limit_parts.append(gas_limit)
        compact_chunks.append({
            'shard_id': ref.get('shard_id'),
            'chunk_hash': ref.get('chunk_hash'),
            'height_created': ref.get('height_created'),
            'height_included': ref.get('height_included'),
            'gas_used': ref.get('gas_used'),
            'gas_limit': ref.get('gas_limit'),
            'matched_returned_shard': matches,
            'reused_prior_block_chunk': is_reused_prior_chunk,
        })
        if matches and not is_reused_prior_chunk:
            for item in transactions:
                tx = item.get('transaction') if isinstance(item, dict) else None
                if not isinstance(tx, dict) or not isinstance(tx.get('hash'), str) or not tx.get('hash'):
                    complete = False
                    warnings.append('At least one transaction item lacked a transaction hash; full transaction set withheld.')
                    continue
                actions = tx.get('actions') if isinstance(tx.get('actions'), list) else []
                action_summaries = []
                action_types = []
                methods = []
                for action in actions:
                    if not isinstance(action, dict) or not action:
                        continue
                    for action_type, details in action.items():
                        action_types.append(str(action_type))
                        if action_type == 'FunctionCall' and isinstance(details, dict):
                            method = details.get('method_name')
                            if isinstance(method, str) and method:
                                methods.append(method)
                            action_summaries.append({'type': 'FunctionCall', 'method_name': method})
                        else:
                            action_summaries.append({'type': str(action_type)})
                tx_rows.append((shard_id if shard_id is not None else -1, {
                    'transaction': tx,
                    'shard_id': shard_id,
                    'action_types': action_types,
                    'function_call_methods': methods,
                    'action_summaries': action_summaries,
                }))

    if not block['chunks']:
        complete = False
        warnings.append('Block response included no shard chunk references; transaction completeness is unknown.')
    return header, compact_chunks, tx_rows, complete, list(dict.fromkeys(warnings))


def _block_batch(payload: dict[str, Any], *, request_url: str, status: int, final_url: str,
                 started_at: str, fetched_at: str, response_sha256: str) -> ProviderBatch:
    header, chunks, tx_rows, chunks_complete, warnings = _summaries(payload)
    block = payload['block']
    height = int(header['height'])
    block_hash = header['hash']
    provider_time = utc_timestamp(header.get('timestamp_nanosec') or header.get('timestamp'))
    chunk_gas_used = [_positive_int(row.get('gas_used')) for row in chunks]
    chunk_gas_limits = [_positive_int(row.get('gas_limit')) for row in chunks]
    tx_count = len(tx_rows) if chunks_complete else None
    block_fields: dict[str, Any] = {
        'block_height': height,
        'block_hash': block_hash,
        'dimensions': {
            'shard_count': len(block.get('chunks', [])),
            'chunks_included': header.get('chunks_included'),
            'transaction_count': tx_count,
            'chunk_hashes_verified': chunks_complete,
        },
    }
    if all(value is not None for value in chunk_gas_used):
        block_fields['gas_used_raw'] = str(sum(chunk_gas_used))
    if all(value is not None for value in chunk_gas_limits):
        block_fields['gas_limit_raw'] = str(sum(chunk_gas_limits))
    if header.get('gas_price') is not None:
        block_fields['gas_price_raw'] = str(header['gas_price'])
    evidence = {
        'block_header': {key: header.get(key) for key in ('height', 'hash', 'timestamp_nanosec', 'gas_price', 'chunks_included', 'epoch_id', 'latest_protocol_version')},
        'chunk_summaries': chunks,
        'transaction_count': tx_count,
    }
    records = [normalize_record(
        record_type='block', source_id=SOURCE_ID, source_endpoint=final_url,
        observed_at=fetched_at, occurred_at=provider_time, provider_observed_at=provider_time,
        external_id=f'{height}:{block_hash}', fields=block_fields, payload=evidence,
    )]
    if chunks_complete:
        for shard_id, row in tx_rows:
            tx = row['transaction']
            has_function_call = any(action == 'FunctionCall' for action in row['action_types'])
            safe_payload = {
                'hash': tx.get('hash'),
                'signer_id': tx.get('signer_id'),
                'receiver_id': tx.get('receiver_id'),
                'nonce': tx.get('nonce'),
                'actions': row['action_summaries'],
            }
            fields = {
                'block_height': height,
                'block_hash': block_hash,
                'transaction_hash': tx['hash'],
                'signer_account_id': tx.get('signer_id'),
                'receiver_account_id': tx.get('receiver_id'),
                'contract_id': tx.get('receiver_id') if has_function_call else None,
                'dimensions': {'shard_id': shard_id, 'action_types': row['action_types'], 'function_call_methods': row['function_call_methods']},
            }
            records.append(normalize_record(
                record_type='transaction', source_id=SOURCE_ID, source_endpoint=final_url,
                observed_at=fetched_at, occurred_at=provider_time, provider_observed_at=provider_time,
                external_id=tx['hash'], fields=fields, payload=safe_payload,
            ))
    return ProviderBatch(
        source_id=SOURCE_ID,
        provider=PROVIDER,
        request_url=request_url,
        final_url=final_url,
        started_at=started_at,
        fetched_at=fetched_at,
        http_status=status,
        provider_observed_at=provider_time,
        response_sha256=response_sha256,
        records=records,
        completeness='complete_for_returned_block_chunks' if chunks_complete else 'partial_block_only',
        warnings=warnings,
        request_metadata={'method': 'GET', 'requested_url': request_url, 'resolved_url': final_url, 'redirect_followed': final_url != request_url},
    )


def fetch_latest_finalized(*, timeout: float = 20.0) -> ProviderBatch:
    payload, status, final_url, started, fetched, response_hash = _read_json(LATEST_URL, timeout=timeout)
    return _block_batch(payload, request_url=LATEST_URL, status=status, final_url=final_url,
                        started_at=started, fetched_at=fetched, response_sha256=response_hash)


def fetch_first_available(*, timeout: float = 20.0) -> ProviderBatch:
    """Read the provider's first-block cursor; does not assert gapless history."""
    payload, status, final_url, started, fetched, response_hash = _read_json(FIRST_URL, timeout=timeout)
    return _block_batch(payload, request_url=FIRST_URL, status=status, final_url=final_url,
                        started_at=started, fetched_at=fetched, response_sha256=response_hash)


def fetch_height(height: int, *, timeout: float = 20.0) -> ProviderBatch:
    if isinstance(height, bool) or not isinstance(height, int) or height < 0:
        raise ValueError('height must be a non-negative integer')
    url = urljoin(BASE_URL + '/', f'v0/block/{height}')
    payload, status, final_url, started, fetched, response_hash = _read_json(url, timeout=timeout)
    batch = _block_batch(payload, request_url=url, status=status, final_url=final_url,
                         started_at=started, fetched_at=fetched, response_sha256=response_hash)
    actual = batch.records[0].fields.get('block_height')
    if actual != height:
        raise ProviderError(SOURCE_ID, f'Requested height {height} but provider returned {actual}', http_status=status)
    return batch
