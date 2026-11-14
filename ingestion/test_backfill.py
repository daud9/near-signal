import unittest

from ingestion.backfill_neardata import MAX_SUPPORTED_BLOCKS_PER_INVOCATION, validate_range


class BackfillRangeTests(unittest.TestCase):
    def test_inclusive_range_and_single_block(self):
        self.assertEqual(validate_range(100, 100, max_blocks=1), 1)
        self.assertEqual(validate_range(100, 102, max_blocks=3), 3)

    def test_rejects_invalid_or_unbounded_ranges(self):
        for args in ((-1, 0, 10), (2, 1, 10), (1, 3, 2), (1, 1, 0),
                     (1, 1, MAX_SUPPORTED_BLOCKS_PER_INVOCATION + 1)):
            with self.subTest(args=args), self.assertRaises(ValueError):
                validate_range(args[0], args[1], max_blocks=args[2])


if __name__ == '__main__':
    unittest.main()
