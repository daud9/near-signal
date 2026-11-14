import test from 'node:test';
import assert from 'node:assert/strict';
import { THESIS_TEST_RECIPE } from '../src/query-registry.js';
import { createThesisTestEvidence } from '../src/thesis.js';

test('the test recipe documents both live APIs, the full-window rule and the product threshold', () => {
  assert.match(THESIS_TEST_RECIPE.query, /api\.coingecko\.com/);
  assert.match(THESIS_TEST_RECIPE.query, /api\.llama\.fi/);
  assert.ok(THESIS_TEST_RECIPE.method.some((line) => /exactly 7, 14 or 30 changes/.test(line)));
  assert.ok(THESIS_TEST_RECIPE.method.some((line) => /not a statistical-significance test/.test(line)));
  assert.ok(THESIS_TEST_RECIPE.limitations.some((line) => /No p-value/.test(line)));
});

test('thesis export retains only the passed source-backed inputs and complete provenance', () => {
  const rawMarket = { fetchedAt: '2026-11-14T12:00:00.000Z', prices: [[1, 3.1]] };
  const rawTvl = [{ date: 1, tvl: 42 }];
  const observations = { 'coingecko-history': { fetchedAt: rawMarket.fetchedAt, providerAt: '2026-11-14T11:59:00.000Z' } };
  const source = { id: 'coingecko-history', name: 'CoinGecko daily market history', url: 'https://api.coingecko.com' };
  const status = { sourceId: source.id, ok: true, checkedAt: rawMarket.fetchedAt };
  const bundle = createThesisTestEvidence({
    exportedAt: '2026-11-14T12:01:00.000Z',
    hypothesis: 'Price and TVL move together', metricA: 'priceUsd', metricB: 'tvlUsd', direction: 'positive', days: 14,
    result: { verdict: 'Insufficient evidence', r: null, n: 4 }, dailyInputs: [{ date: '2026-11-01', priceUsd: 3.1, tvlUsd: 42 }],
    rawCoinGeckoMarketChart: rawMarket, rawTvlRows: rawTvl, sourceObservations: observations, sources: [source], sourceStatuses: [status],
  });
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.exportedAt, '2026-11-14T12:01:00.000Z');
  assert.deepEqual(bundle.selection, { metricA: 'priceUsd', metricB: 'tvlUsd', direction: 'positive', days: 14 });
  assert.deepEqual(bundle.rawInputs.coinGeckoMarketChart, rawMarket);
  assert.deepEqual(bundle.rawInputs.defillamaTvlRows, rawTvl);
  assert.deepEqual(bundle.provenance.sourceObservations, observations);
  assert.deepEqual(bundle.provenance.sources, [source]);
  assert.deepEqual(bundle.provenance.sourceStatuses, [status]);
  assert.deepEqual(bundle.provenance.recipe, THESIS_TEST_RECIPE);
  assert.deepEqual(bundle.limitations, THESIS_TEST_RECIPE.limitations);
});
