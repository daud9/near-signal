"""NEAR SIGNAL unified ingestion entry point.

Default mode performs one read-only Neardata fetch and prints a compact report; it
does not persist, schedule, backfill, run BigQuery, or call credential-gated providers.
"""
from __future__ import annotations

import argparse
import json
import sys

from .catalog import list_sources
from .postgres_store import connect, initialize_schema
from .providers.base import ProviderError
from .providers.fastnear_rpc import fetch_latest_with_fallback
from .providers.neardata import SOURCE_ID as NEARDATA_ID, fetch_first_available, fetch_height, fetch_latest_finalized
from .runner import run_with_persistence


def _report(batch, persistence=None) -> dict:
    block = next((record for record in batch.records if record.record_type == 'block'), None)
    transaction_count = None
    height = None
    block_hash = None
    if block:
        height = block.fields.get('block_height')
        block_hash = block.fields.get('block_hash')
        transaction_count = (block.fields.get('dimensions') or {}).get('transaction_count')
    return {
        'source_id': batch.source_id,
        'provider': batch.provider,
        'request_url': batch.request_url,
        'resolved_url': batch.final_url,
        'http_status': batch.http_status,
        'fetched_at': batch.fetched_at,
        'provider_block_time': batch.provider_observed_at,
        'response_sha256': batch.response_sha256,
        'block_height': height,
        'block_hash': block_hash,
        'transaction_count': transaction_count,
        'transaction_rows': sum(record.record_type == 'transaction' for record in batch.records),
        'record_count': len(batch.records),
        'completeness': batch.completeness,
        'warnings': batch.warnings,
        'persisted': persistence is not None,
        'persistence': persistence,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='NEAR SIGNAL read-only data ingestion')
    parser.add_argument('--list-sources', action='store_true', help='Print verified source/access status; no network calls')
    parser.add_argument('--first-available', action='store_true', help='Fetch Neardata first-block cursor (one request)')
    parser.add_argument('--height', type=int, help='Fetch one exact Neardata block height')
    parser.add_argument('--no-fallback', action='store_true', help='Do not use FastNEAR public RPC if Neardata latest fails')
    parser.add_argument('--persist', action='store_true', help='Write this single fetch to PostgreSQL (requires NEAR_SIGNAL_DATABASE_URL)')
    parser.add_argument('--derive-observed-metrics', action='store_true', help='Also persist explicitly observed-only metrics; requires --persist')
    parser.add_argument('--initialize-schema', action='store_true', help='Apply checked-in PostgreSQL DDL; requires --persist')
    parser.add_argument('--timeout', type=float, default=20.0, help='Provider request timeout in seconds (default: 20)')
    args = parser.parse_args(argv)

    if args.list_sources:
        print(json.dumps(list_sources(), indent=2, sort_keys=True))
        return 0
    if args.first_available and args.height is not None:
        parser.error('--first-available and --height are mutually exclusive')
    if args.derive_observed_metrics and not args.persist:
        parser.error('--derive-observed-metrics requires --persist')
    if args.initialize_schema and not args.persist:
        parser.error('--initialize-schema requires --persist')

    if args.first_available:
        request_url = 'https://mainnet.neardata.xyz/v0/first_block'
        fetch = lambda: fetch_first_available(timeout=args.timeout)
    elif args.height is not None:
        request_url = f'https://mainnet.neardata.xyz/v0/block/{args.height}'
        fetch = lambda: fetch_height(args.height, timeout=args.timeout)
    elif args.no_fallback:
        request_url = 'https://mainnet.neardata.xyz/v0/last_block/final'
        fetch = lambda: fetch_latest_finalized(timeout=args.timeout)
    else:
        request_url = 'https://mainnet.neardata.xyz/v0/last_block/final'
        fetch = lambda: fetch_latest_with_fallback(timeout=args.timeout)

    if not args.persist:
        try:
            batch = fetch()
        except (ProviderError, ValueError) as exc:
            print(json.dumps({'ok': False, 'error': str(exc), 'http_status': getattr(exc, 'http_status', None)}))
            return 1
        print(json.dumps(_report(batch), indent=2, sort_keys=True))
        print('Not persisted: pass --persist with NEAR_SIGNAL_DATABASE_URL after configuring an authorized PostgreSQL database.')
        return 0

    try:
        with connect() as connection:
            if args.initialize_schema:
                initialize_schema(connection)
            initial_source_id = NEARDATA_ID
            batch, persistence = run_with_persistence(
                connection,
                initial_source_id,
                request_url,
                fetch,
                request_metadata={
                    'mode': 'first_available' if args.first_available else 'height' if args.height is not None else 'latest_finalized',
                    'height': args.height,
                    'fallback_enabled': not args.no_fallback,
                },
                derive_observed_metrics=args.derive_observed_metrics,
            )
        print(json.dumps(_report(batch, persistence), indent=2, sort_keys=True))
        return 0
    except (ProviderError, RuntimeError, ValueError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc), 'http_status': getattr(exc, 'http_status', None)}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
