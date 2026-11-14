import unittest

from ingestion.providers.fastnear_rpc import fetch_finalized_block


class FastnearPublicRpcSmokeTests(unittest.TestCase):
    @unittest.skipUnless(__import__('os').environ.get('NEAR_SIGNAL_LIVE_PROVIDER_TESTS') == '1',
                         'set NEAR_SIGNAL_LIVE_PROVIDER_TESTS=1 to make one read-only RPC request')
    def test_live_finalized_block_fallback_shape(self):
        batch = fetch_finalized_block(timeout=15)
        self.assertEqual(batch.http_status, 200)
        self.assertEqual(batch.source_id, 'fastnear-public-rpc')
        self.assertEqual(batch.completeness, 'fallback_block_only')
        self.assertEqual(len(batch.records), 1)
        self.assertEqual(batch.records[0].record_type, 'block')
        self.assertFalse(any(record.record_type == 'transaction' for record in batch.records))


if __name__ == '__main__':
    unittest.main()
