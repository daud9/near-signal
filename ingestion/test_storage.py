import unittest
from uuid import uuid4

from ingestion.calculations import build_metric_observations
from ingestion.catalog import list_sources
from ingestion.normalization import normalize_record
from ingestion.postgres_store import (FREE_TIER_DATABASE_HARD_STOP_BYTES, connect,
                                      ensure_database_storage_budget, persist_metric, persist_records)


class RecordingConnection:
    def __init__(self):
        self.calls = []

    def execute(self, query, params=None):
        if params is not None:
            self.calls.append((query, params))
            self.assert_placeholder_count(query, params)
        return self

    @staticmethod
    def assert_placeholder_count(query, params):
        count = query.count('%s')
        if count != len(params):
            raise AssertionError(f'SQL has {count} placeholders but {len(params)} values were supplied')


class SizeResult:
    def __init__(self, size):
        self.size = size

    def fetchone(self):
        return (self.size,)


class SizeConnection:
    def __init__(self, size):
        self.size = size

    def execute(self, query):
        if query != 'SELECT pg_database_size(current_database())':
            raise AssertionError('unexpected database-size query')
        return SizeResult(self.size)


class StorageSafetyTests(unittest.TestCase):
    def test_no_database_url_means_no_external_database_attempt(self):
        with self.assertRaisesRegex(RuntimeError, 'no external database was accessed'):
            connect('')

    def test_catalog_disables_unverified_and_unauthorized_providers(self):
        sources = {item['source_id']: item for item in list_sources()}
        self.assertTrue(sources['neardata-mainnet']['enabled'])
        self.assertTrue(sources['fastnear-public-rpc']['enabled'])
        self.assertFalse(sources['nearblocks-api']['enabled'])
        self.assertFalse(sources['pikespeak-api']['enabled'])
        self.assertFalse(sources['fastnear-indexed-api']['enabled'])
        self.assertFalse(sources['intear-events-api']['enabled'])
        self.assertFalse(sources['near-intents-explorer-api']['enabled'])
        self.assertFalse(sources['bigquery-near-mainnet']['enabled'])
        self.assertIn('10/min', sources['nearblocks-api']['rate_limit_note'])
        self.assertIn('no earliest', sources['nearblocks-api']['historical_coverage'])

    def test_database_storage_guard_allows_size_below_configured_stop(self):
        self.assertEqual(ensure_database_storage_budget(SizeConnection(99), max_bytes=100), 99)

    def test_database_storage_guard_stops_at_or_above_limit(self):
        with self.assertRaisesRegex(RuntimeError, 'no data was persisted'):
            ensure_database_storage_budget(SizeConnection(100), max_bytes=100)

    def test_database_storage_guard_never_allows_raising_free_ceiling(self):
        with self.assertRaisesRegex(RuntimeError, 'persistence refused'):
            ensure_database_storage_budget(SizeConnection(0), max_bytes=FREE_TIER_DATABASE_HARD_STOP_BYTES + 1)

    def test_database_storage_guard_fails_closed_when_size_is_unavailable(self):
        with self.assertRaisesRegex(RuntimeError, 'persistence refused'):
            ensure_database_storage_budget(SizeConnection(None), max_bytes=100)

    def test_postgres_sql_parameter_counts_align_for_records_and_metric(self):
        connection = RecordingConnection()
        run_id = uuid4()
        record = normalize_record(
            record_type='transaction', source_id='neardata-mainnet',
            source_endpoint='https://mainnet.neardata.xyz/v0/block/224000000',
            observed_at='2026-11-14T16:01:00Z', provider_observed_at='2026-11-14T16:00:59Z',
            occurred_at='2026-11-14T16:00:59Z', external_id='tx-sql-check',
            fields={'transaction_hash': 'tx-sql-check', 'signer_account_id': 'alice.near'},
            payload={'transaction_hash': 'tx-sql-check'},
        )
        self.assertEqual(persist_records(connection, run_id=run_id, records=[record]), 1)
        self.assertEqual(len(connection.calls), 2)  # latest normalized entity plus run-specific observation
        metric = build_metric_observations([record], calculated_at='2026-11-14T16:02:00Z')[0]
        persist_metric(connection, run_id=run_id, observation=metric, calculated_at=metric['calculated_at'],
                       input_record_count=metric['input_record_count'], calculation_name=metric['calculation_name'],
                       calculation_version=metric['calculation_version'], calculation_json=metric['calculation_json'])
        self.assertEqual(len(connection.calls), 3)


if __name__ == '__main__':
    unittest.main()
