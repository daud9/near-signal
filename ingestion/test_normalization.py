import unittest

from calculations import (build_metric_observations, daily_activity, daily_contract_activity,
                          daily_event_counts, daily_intent_swap_counts)
from normalization import normalize_metric, normalize_record, utc_timestamp


class NormalizationTests(unittest.TestCase):
    def test_normalizes_seconds_milliseconds_nanoseconds_and_iso(self):
        expected = '2026-11-14T16:54:53.000000Z'
        seconds = 1794675293
        millis = seconds * 1000
        nanos = seconds * 1_000_000_000
        self.assertEqual(utc_timestamp(seconds), expected)
        self.assertEqual(utc_timestamp(millis), expected)
        self.assertEqual(utc_timestamp(nanos), expected)
        self.assertEqual(utc_timestamp(expected), expected)

    def test_invalid_timestamp_stays_unavailable(self):
        for value in (None, True, 0, 'bad timestamp', float('inf')):
            self.assertIsNone(utc_timestamp(value))

    def test_record_hash_is_stable_and_source_specific(self):
        args = dict(record_type='transaction', source_id='provider-a', source_endpoint='https://api.example.test/tx',
                    observed_at='2026-11-14T16:00:00Z', occurred_at='2026-11-14T15:00:00Z',
                    external_id='tx-1', fields={'transaction_hash': 'tx-1'}, payload={'hash': 'tx-1'})
        first = normalize_record(**args)
        self.assertEqual(first.record_id, normalize_record(**args).record_id)
        self.assertNotEqual(first.record_id, normalize_record(**{**args, 'source_id': 'provider-b'}).record_id)
        self.assertEqual(len(first.payload_sha256), 64)

    def test_record_requires_secure_endpoint_and_observation_time(self):
        base = dict(record_type='event', source_id='intear', source_endpoint='http://api.example.test/events',
                    observed_at='2026-11-14T16:00:00Z', fields={}, payload={})
        with self.assertRaises(ValueError):
            normalize_record(**base)
        with self.assertRaises(ValueError):
            normalize_record(**{**base, 'source_endpoint': 'https://api.example.test/events', 'observed_at': None})

    def test_missing_metric_is_not_coerced_to_zero(self):
        args = dict(metric_name='daily_signers', value=None, unit='accounts', source_id='pikespeak',
                    source_endpoint='https://api.example.test/metrics', observed_at='2026-11-14T16:00:00Z')
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            normalize_metric(**args)

    def test_metric_keeps_source_and_timestamps_and_is_idempotent(self):
        args = dict(metric_name='daily_signers', value=12, unit='accounts', source_id='pikespeak',
                    source_endpoint='https://api.example.test/metrics', observed_at='2026-11-14T16:00:00Z',
                    provider_observed_at='2026-11-14T00:00:00Z', period_start='2026-11-14T00:00:00Z',
                    period_end='2026-11-14T23:59:59Z', dimensions={'network': 'mainnet'})
        first = normalize_metric(**args)
        self.assertEqual(first['observation_id'], normalize_metric(**args)['observation_id'])
        self.assertEqual(first['source_id'], 'pikespeak')
        self.assertEqual(first['provider_observed_at'], '2026-11-14T00:00:00.000000Z')


class CalculationTests(unittest.TestCase):
    def test_daily_activity_is_source_scoped_and_does_not_guess_signers(self):
        base = {'record_type': 'transaction', 'fields': {
            'occurred_at': '2026-11-14T12:00:00Z', 'transaction_hash': 'tx-1', 'signer_account_id': 'alice.near'}}
        rows = daily_activity([
            {**base, 'source_id': 'provider-a'},
            {**base, 'source_id': 'provider-a'},  # duplicate observation, deduplicated by transaction hash
            {'source_id': 'provider-a', 'record_type': 'transaction', 'fields': {
                'occurred_at': '2026-11-14T13:00:00Z', 'transaction_hash': 'tx-2'}},
            {**base, 'source_id': 'provider-b'},
        ])
        self.assertEqual(len(rows), 2)
        first = next(row for row in rows if row['source_id'] == 'provider-a')
        self.assertEqual(first['transaction_count'], 2)
        self.assertIsNone(first['active_signer_accounts'])
        self.assertEqual(first['missing_signer_rows'], 1)
        second = next(row for row in rows if row['source_id'] == 'provider-b')
        self.assertEqual(second['transaction_count'], 1)
        self.assertEqual(second['active_signer_accounts'], 1)

    def test_contract_activity_counts_only_top_level_function_calls(self):
        rows = daily_contract_activity([
            {'source_id': 'provider-a', 'record_type': 'transaction', 'fields': {
                'occurred_at': '2026-11-14T12:00:00Z', 'transaction_hash': 'tx-1', 'signer_account_id': 'alice.near',
                'contract_id': 'market.near', 'dimensions': {'action_types': ['FunctionCall']}}},
            {'source_id': 'provider-a', 'record_type': 'transaction', 'fields': {
                'occurred_at': '2026-11-14T12:01:00Z', 'transaction_hash': 'tx-2', 'contract_id': 'market.near',
                'dimensions': {'action_types': ['Transfer']}}},
        ])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['function_call_transaction_count'], 1)
        self.assertIn('receipt-generated calls are not included', rows[0]['coverage_note'])

    def test_metric_envelopes_keep_hashes_endpoints_and_all_timestamps(self):
        record = normalize_record(
            record_type='transaction', source_id='neardata-mainnet',
            source_endpoint='https://mainnet.neardata.xyz/v0/block/224000000',
            observed_at='2026-11-14T16:01:00Z', provider_observed_at='2026-11-14T16:00:59Z',
            occurred_at='2026-11-14T16:00:59Z', external_id='tx-metric-1',
            fields={'transaction_hash': 'tx-metric-1', 'signer_account_id': 'alice.near',
                    'contract_id': 'market.near', 'dimensions': {'action_types': ['FunctionCall']}},
            payload={'transaction_hash': 'tx-metric-1'},
        )
        observations = build_metric_observations([record], calculated_at='2026-11-14T16:02:00Z')
        names = {row['metric_name'] for row in observations}
        self.assertEqual(names, {
            'observed_transaction_count', 'observed_distinct_signer_accounts',
            'observed_function_call_transactions',
        })
        for metric in observations:
            self.assertEqual(metric['source_id'], 'neardata-mainnet')
            self.assertEqual(metric['source_endpoint'], record.source_endpoint)
            self.assertEqual(metric['observed_at'], record.observed_at)
            self.assertEqual(metric['provider_observed_at'], record.provider_observed_at)
            self.assertEqual(metric['calculated_at'], '2026-11-14T16:02:00.000000Z')
            self.assertEqual(metric['input_record_count'], 1)
            self.assertEqual(metric['input_sha256'], metric['calculation_json']['input_sha256'])
            self.assertEqual(len(metric['input_sha256']), 64)
            self.assertEqual(metric['calculation_json']['input_record_id_sample'], [record.record_id])
            self.assertFalse(metric['calculation_json']['input_record_ids_truncated'])
            self.assertEqual(metric['period_start'], '2026-11-14T00:00:00.000000Z')
            self.assertEqual(metric['period_end'], '2026-11-15T00:00:00.000000Z')

    def test_metric_lineage_samples_are_bounded_for_large_input_groups(self):
        records = [normalize_record(
            record_type='transaction', source_id='neardata-mainnet',
            source_endpoint=f'https://mainnet.neardata.xyz/v0/block/{height}',
            observed_at='2026-11-14T16:01:00Z', provider_observed_at='2026-11-14T16:00:59Z',
            occurred_at='2026-11-14T16:00:59Z', external_id=f'tx-{height}',
            fields={'transaction_hash': f'tx-{height}', 'signer_account_id': f'account-{height}.near'},
            payload={'transaction_hash': f'tx-{height}'},
        ) for height in range(25)]
        metrics = build_metric_observations(records, calculated_at='2026-11-14T16:02:00Z')
        transaction_metric = next(row for row in metrics if row['metric_name'] == 'observed_transaction_count')
        lineage = transaction_metric['calculation_json']
        self.assertEqual(transaction_metric['input_record_count'], 25)
        self.assertEqual(len(lineage['input_record_id_sample']), 20)
        self.assertTrue(lineage['input_record_ids_truncated'])
        self.assertEqual(len(lineage['source_endpoint_examples']), 5)
        replay = next(row for row in build_metric_observations(
            records, calculated_at='2026-11-14T16:03:00Z') if row['metric_name'] == 'observed_transaction_count')
        self.assertEqual(transaction_metric['input_sha256'], replay['input_sha256'])
        self.assertEqual(transaction_metric['observation_id'], replay['observation_id'])

    def test_missing_signer_or_collection_provenance_is_not_filled(self):
        no_signer = normalize_record(
            record_type='transaction', source_id='neardata-mainnet',
            source_endpoint='https://mainnet.neardata.xyz/v0/block/224000000',
            observed_at='2026-11-14T16:01:00Z', occurred_at='2026-11-14T16:00:59Z',
            external_id='tx-no-signer', fields={'transaction_hash': 'tx-no-signer'}, payload={'hash': 'tx-no-signer'},
        )
        metric_names = {row['metric_name'] for row in build_metric_observations(
            [no_signer], calculated_at='2026-11-14T16:02:00Z')}
        self.assertEqual(metric_names, {'observed_transaction_count'})
        unprovenanced = {'source_id': 'neardata-mainnet', 'record_type': 'transaction', 'fields': {
            'occurred_at': '2026-11-14T16:00:59Z', 'transaction_hash': 'tx-unobserved', 'signer_account_id': 'alice.near'}}
        self.assertEqual(build_metric_observations([unprovenanced], calculated_at='2026-11-14T16:02:00Z'), [])
        self.assertEqual(build_metric_observations([no_signer, unprovenanced], calculated_at='2026-11-14T16:02:00Z'), [])

    def test_empty_history_does_not_create_zero_filled_dates(self):
        self.assertEqual(daily_activity([]), [])
        self.assertEqual(daily_contract_activity([]), [])
        self.assertEqual(daily_event_counts([]), [])
        self.assertEqual(daily_intent_swap_counts([]), [])
        self.assertEqual(build_metric_observations([]), [])

    def test_event_counts_keep_provider_and_contract_dimensions(self):
        rows = daily_event_counts([
            {'source_id': 'intear', 'record_type': 'event', 'fields': {
                'occurred_at': '2026-11-14T12:00:00Z', 'external_id': 'e1', 'contract_id': 'swap.near',
                'event_standard': 'nep141', 'event_name': 'ft_transfer'}},
            {'source_id': 'intear', 'record_type': 'event', 'fields': {
                'occurred_at': '2026-11-14T12:00:00Z', 'external_id': 'e1', 'contract_id': 'swap.near',
                'event_standard': 'nep141', 'event_name': 'ft_transfer'}},
        ])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['event_count'], 1)

    def test_swap_counts_do_not_claim_amount_or_net_flow(self):
        rows = daily_intent_swap_counts([{
            'source_id': 'intents', 'record_type': 'intent_swap', 'fields': {
                'occurred_at': '2026-11-14T12:00:00Z', 'swap_id': 's1'}}])
        self.assertEqual(rows[0]['swap_record_count'], 1)
        self.assertNotIn('amount_usd', rows[0])
        self.assertIn('not all Intents routes', rows[0]['coverage_note'])


if __name__ == '__main__':
    unittest.main()
