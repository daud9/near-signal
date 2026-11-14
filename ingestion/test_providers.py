import unittest

from ingestion.bigquery_dry_run import build_dry_run_request
from ingestion.providers.neardata import _block_batch


class NeardataNormalizationTests(unittest.TestCase):
    def make_payload(self, *, mismatch=False, transactions=True):
        refs = [
            {'shard_id': 0, 'chunk_hash': 'chunk-a', 'height_included': 100, 'gas_used': '10', 'gas_limit': '100'},
            {'shard_id': 1, 'chunk_hash': 'chunk-b', 'height_included': 100, 'gas_used': '20', 'gas_limit': '100'},
        ]
        txs = []
        if transactions:
            txs = [{'transaction': {
                'hash': 'tx-hash-1', 'signer_id': 'alice.near', 'receiver_id': 'market.near',
                'nonce': 4, 'signature': 'must-not-be-stored', 'public_key': 'must-not-be-stored',
                'actions': [{'FunctionCall': {'method_name': 'swap', 'args': 'opaque-args', 'gas': 1, 'deposit': '0'}}],
            }}]
        chunks = []
        shards = []
        for ref in refs:
            chunks.append(dict(ref))
            shard_chunk = {
                'header': {
                    'chunk_hash': 'wrong-hash' if mismatch and ref['shard_id'] == 1 else ref['chunk_hash'],
                    'height_included': ref['height_included'],
                },
                'transactions': txs if ref['shard_id'] == 0 else [],
            }
            shards.append({'shard_id': ref['shard_id'], 'chunk': shard_chunk})
        return {
            'block': {'header': {
                'height': 100, 'hash': 'block-hash-100', 'timestamp_nanosec': '1794675293000000000',
                'gas_price': '1000', 'chunks_included': 2,
            }, 'chunks': chunks},
            'shards': shards,
        }

    def batch(self, payload):
        return _block_batch(payload, request_url='https://mainnet.neardata.xyz/v0/last_block/final',
                            status=200, final_url='https://mainnet.neardata.xyz/v0/block/100',
                            started_at='2026-11-14T16:00:00Z', fetched_at='2026-11-14T16:00:01Z',
                            response_sha256='a' * 64)

    def test_complete_verified_chunks_emit_block_and_sanitized_transaction(self):
        batch = self.batch(self.make_payload())
        self.assertEqual(batch.completeness, 'complete_for_returned_block_chunks')
        self.assertEqual(len(batch.records), 2)
        block, tx = batch.records
        self.assertEqual(block.fields['dimensions']['transaction_count'], 1)
        self.assertEqual(block.fields['gas_used_raw'], '30')
        self.assertEqual(tx.fields['signer_account_id'], 'alice.near')
        self.assertEqual(tx.fields['contract_id'], 'market.near')
        self.assertEqual(tx.fields['dimensions']['function_call_methods'], ['swap'])
        self.assertNotIn('signature', tx.payload)
        self.assertNotIn('public_key', tx.payload)
        self.assertNotIn('args', str(tx.payload))

    def test_mismatched_chunk_withholds_all_transaction_rows_and_count(self):
        batch = self.batch(self.make_payload(mismatch=True))
        self.assertEqual(batch.completeness, 'partial_block_only')
        self.assertEqual(len(batch.records), 1)
        self.assertIsNone(batch.records[0].fields['dimensions']['transaction_count'])
        self.assertTrue(batch.warnings)

    def test_verified_empty_block_is_zero_for_that_block_not_history(self):
        batch = self.batch(self.make_payload(transactions=False))
        self.assertEqual(batch.records[0].fields['dimensions']['transaction_count'], 0)
        self.assertEqual(len(batch.records), 1)


class BigQueryDryRunTests(unittest.TestCase):
    def test_dry_run_only_request_is_parameterized_and_never_executes(self):
        url, request = build_dry_run_request(
            'SELECT @start_date, @end_date, @contract_account_id',
            start_date='2026-01-01', end_date='2026-01-03',
            contract_account_id='sample.near', project_id='near-signal-test1',
        )
        self.assertIn('/projects/near-signal-test1/jobs', url)
        self.assertIs(request['configuration']['dryRun'], True)
        self.assertIs(request['configuration']['query']['useLegacySql'], False)
        params = request['configuration']['query']['queryParameters']
        self.assertEqual([item['name'] for item in params], ['start_date', 'end_date', 'contract_account_id'])
        self.assertEqual([item['parameterType']['type'] for item in params], ['DATE', 'DATE', 'STRING'])
        self.assertNotIn('destinationTable', request['configuration']['query'])

    def test_project_and_range_must_be_explicit_and_valid(self):
        with self.assertRaisesRegex(ValueError, 'project ID'):
            build_dry_run_request('SELECT 1', start_date='2026-01-01', end_date='2026-01-02',
                                  contract_account_id='a.near', project_id='')
        with self.assertRaisesRegex(ValueError, 'earlier'):
            build_dry_run_request('SELECT 1', start_date='2026-01-02', end_date='2026-01-01',
                                  contract_account_id='a.near', project_id='near-signal-test1')


if __name__ == '__main__':
    unittest.main()
