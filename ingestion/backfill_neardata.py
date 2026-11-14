"""Explicit bounded Neardata height-range backfill; never runs automatically.

The provider's numeric request limit is unpublished, so requests are sequential with
a conservative 5-second minimum delay. Choose a bounded range; do not attempt an
unbounded archive dump without written provider guidance on quota and retention.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from .postgres_store import connect, initialize_schema
from .providers.neardata import SOURCE_ID, BASE_URL, fetch_height
from .runner import run_with_persistence

MAX_SUPPORTED_BLOCKS_PER_INVOCATION = 10_000
MIN_DELAY_MS = 5_000


def validate_range(start_height: int, end_height: int, *, max_blocks: int) -> int:
    if start_height < 0 or end_height < 0:
        raise ValueError('block heights must be non-negative integers')
    if end_height < start_height:
        raise ValueError('end height must be greater than or equal to start height')
    if max_blocks < 1 or max_blocks > MAX_SUPPORTED_BLOCKS_PER_INVOCATION:
        raise ValueError(f'max_blocks must be between 1 and {MAX_SUPPORTED_BLOCKS_PER_INVOCATION}')
    count = end_height - start_height + 1
    if count > max_blocks:
        raise ValueError(f'range contains {count} blocks, exceeding max_blocks={max_blocks}; split into smaller ranges')
    return count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Sequential, bounded Neardata historical backfill to PostgreSQL')
    parser.add_argument('--from-height', type=int, required=True, help='Inclusive starting block height')
    parser.add_argument('--to-height', type=int, required=True, help='Inclusive ending block height')
    parser.add_argument('--max-blocks', type=int, default=100, help='Maximum blocks for this invocation (default: 100; hard max: 10000)')
    parser.add_argument('--delay-ms', type=int, default=MIN_DELAY_MS, help='Wait between requests (minimum: 5000; default: 5000)')
    parser.add_argument('--timeout', type=float, default=20.0, help='Per-block request timeout in seconds')
    parser.add_argument('--initialize-schema', action='store_true', help='Apply the checked-in DDL before ingestion')
    parser.add_argument('--derive-observed-metrics', action='store_true', help='Also store source-scoped observed-only metric snapshots')
    args = parser.parse_args(argv)

    try:
        total = validate_range(args.from_height, args.to_height, max_blocks=args.max_blocks)
        if args.delay_ms < MIN_DELAY_MS:
            raise ValueError(f'delay-ms must be at least {MIN_DELAY_MS}; provider quota is undocumented')
        with connect() as connection:
            if args.initialize_schema:
                initialize_schema(connection)
            completed = 0
            for height in range(args.from_height, args.to_height + 1):
                request_url = f'{BASE_URL}/v0/block/{height}'
                batch, result = run_with_persistence(
                    connection,
                    SOURCE_ID,
                    request_url,
                    lambda h=height: fetch_height(h, timeout=args.timeout),
                    request_metadata={'mode': 'explicit_height_backfill', 'height': height,
                                      'range_start': args.from_height, 'range_end': args.to_height,
                                      'request_delay_ms': args.delay_ms},
                    derive_observed_metrics=args.derive_observed_metrics,
                )
                completed += 1
                block = batch.records[0]
                print(json.dumps({
                    'height': height,
                    'block_hash': block.fields.get('block_hash'),
                    'status': result['status'],
                    'records': result['records'],
                    'metrics': result['metrics'],
                    'progress': f'{completed}/{total}',
                    'resolved_url': batch.final_url,
                }), flush=True)
                if completed < total:
                    time.sleep(args.delay_ms / 1000)
        print(json.dumps({'ok': True, 'blocks_ingested': completed, 'from_height': args.from_height,
                          'to_height': args.to_height, 'pacing_ms': args.delay_ms,
                          'note': 'Sequential explicit range only; this does not certify gapless archive coverage.'}))
        return 0
    except (RuntimeError, ValueError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
