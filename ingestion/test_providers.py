import unittest

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

    def test_duplicate_returned_shard_withholds_all_transaction_rows_and_count(self):
        payload = self.make_payload()
        payload['shards'].append(dict(payload['shards'][0]))
        batch = self.batch(payload)
        self.assertEqual(batch.completeness, 'partial_block_only')
        self.assertEqual(len(batch.records), 1)
        self.assertIsNone(batch.records[0].fields['dimensions']['transaction_count'])
        self.assertTrue(any('duplicate' in warning.lower() for warning in batch.warnings))

    def test_duplicate_block_reference_withholds_all_transaction_rows_and_count(self):
        payload = self.make_payload()
        payload['block']['chunks'].append(dict(payload['block']['chunks'][0]))
        batch = self.batch(payload)
        self.assertEqual(batch.completeness, 'partial_block_only')
        self.assertEqual(len(batch.records), 1)
        self.assertIsNone(batch.records[0].fields['dimensions']['transaction_count'])
        self.assertTrue(any('duplicate' in warning.lower() for warning in batch.warnings))
    def test_verified_empty_block_is_zero_for_that_block_not_history(self):
        batch = self.batch(self.make_payload(transactions=False))
        self.assertEqual(batch.records[0].fields['dimensions']['transaction_count'], 0)
        self.assertEqual(len(batch.records), 1)

    def test_reused_prior_height_chunk_is_zero_and_does_not_require_old_payload(self):
        payload = self.make_payload()
        payload['block']['chunks'][1]['height_included'] = 99
        payload['shards'][1]['chunk'] = None
        batch = self.batch(payload)
        self.assertEqual(batch.completeness, 'complete_for_returned_block_chunks')
        self.assertEqual(batch.records[0].fields['dimensions']['transaction_count'], 1)
        self.assertEqual(len(batch.records), 2)

        payload = self.make_payload()
        payload['block']['chunks'][1]['height_included'] = 99
        payload['shards'][1]['chunk']['header']['height_included'] = 99
        payload['shards'][1]['chunk']['transactions'] = [{'transaction': {'hash': 'old-tx', 'signer_id': 'old.near', 'receiver_id': 'old.near', 'actions': []}}]
        batch = self.batch(payload)
        self.assertEqual(batch.completeness, 'complete_for_returned_block_chunks')
        self.assertEqual(batch.records[0].fields['dimensions']['transaction_count'], 1)
        self.assertNotIn('old-tx', [record.fields.get('transaction_hash') for record in batch.records])


if __name__ == '__main__':
    unittest.main()
