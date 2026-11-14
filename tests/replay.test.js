import assert from 'node:assert/strict';
import test from 'node:test';
import { replayChartInputs, replayRpcObservations } from '../src/replay.js';

// Test-only fixtures, never used by the dashboard or evidence rebuild.
const rawBlock = { header: { height: 1, hash: 'fixture-block', timestamp: '1704067200000000000', gas_price: '100000000' }, chunks: [{ chunk_hash: 'fixture-chunk', shard_id: 0, height_included: 1, gas_used: '1000000000000', gas_limit: '1000000000000000' }] };
const rawChunks = [{ header: { shard_id: 0, chunk_hash: 'fixture-chunk', height_included: 1 }, transactions: [{ hash: 'fixture-tx' }] }];
const observation = { observedAt: '2024-01-01T00:00:01.000Z', rawBlock, rawChunks };

test('RPC replay derives gas and count from raw responses rather than saved summaries', () => {
  const rows = replayRpcObservations([{ ...observation, gasUsed: 999, transactionCount: 999 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gasTgas, 1);
  assert.equal(rows[0].transactionCount, 1);
  assert.equal(rows[0].transactionChunkCount, 1);
  assert.equal(rows[0].transactionShardCount, 1);
  assert.equal(rows[0].transactionReusedShardCount, 0);
  assert.equal(rows[0].height, 1);
});

test('offline replay ignores reused prior-height transactions and accounts for their shard', () => {
  const blockWithReused = {
    header: rawBlock.header,
    chunks: [
      ...rawBlock.chunks,
      { chunk_hash: 'old-chunk', shard_id: 1, height_included: 0, gas_used: '0', gas_limit: '1000000000000000' },
    ],
  };
  const rows = replayRpcObservations([{ observedAt: observation.observedAt, rawBlock: blockWithReused, rawChunks }]);
  assert.equal(rows[0].transactionCount, 1);
  assert.equal(rows[0].transactionChunkCount, 1);
  assert.equal(rows[0].transactionShardCount, 2);
  assert.equal(rows[0].transactionReusedShardCount, 1);
});

test('legacy summary-only and mismatched shard data never create fabricated chart points', () => {
  assert.deepEqual(replayRpcObservations([{ observedAt: observation.observedAt, height: 1, gasUsed: 999 }]), []);
  const rows = replayRpcObservations([{ ...observation, rawChunks: [{ ...rawChunks[0], header: { ...rawChunks[0].header, chunk_hash: 'wrong' } }] }]);
  assert.equal(rows[0].transactionCount, null);
  assert.equal(rows[0].gasTgas, 1);
});

test('chart replay is deterministic, uses original UTC cutoff, and needs no network', () => {
  const bundle = {
    generatedAt: '2024-01-02T12:00:00.000Z',
    rawReturnedData: {
      defillamaTvlRows: [{ date: 1704067200, tvl: 10 }, { date: 1704153600, tvl: 20 }],
      coinGeckoMarketChart: { prices: [[1704067200000, 2], [1704153600000, 3]] },
    },
    rawNearDexVolumeRows: [{ date: '2024-01-01', valueUsd: 3 }, { date: '2024-01-02', valueUsd: 4 }, { date: '2024-01-03', valueUsd: 5 }],
    rawNearFeeRows: [{ date: '2024-01-01', valueUsd: 1 }, { date: '2024-01-02', valueUsd: 2 }],
    rawRpcObservationHistory: [observation],
  };
  const result = replayChartInputs(bundle);
  assert.deepEqual(result, replayChartInputs(JSON.parse(JSON.stringify(bundle))));
  assert.deepEqual(result.overviewChart.map((row) => row.date), ['2024-01-01']);
  assert.equal(result.capitalChart[0].tvlUsd, 10);
  assert.deepEqual(result.dexVolumeChart, [{ date: '2024-01-01', valueUsd: 3 }]);
  assert.deepEqual(result.feeHistoryChart, [{ date: '2024-01-01', valueUsd: 1 }]);
  assert.equal(result.gasChart[0].gasTgas, 1);
  assert.equal(result.blockTxChart[0].transactionCount, 1);
});

test('browser export shape replays and missing series remain empty', () => {
  const bundle = { exportedAt: observation.observedAt, rawTvlRows: [], rawCoinGeckoMarketChart: {}, rawNearDexVolumeRows: [{ date: '2024-01-01', valueUsd: null }, { date: '2024-01-02', valueUsd: 3 }], localRpcObservationHistory: [observation], chartSelections: { days: 7, metric: 'tvlUsd' } };
  assert.equal(replayChartInputs(bundle).selections.metric, 'tvlUsd');
  assert.deepEqual(replayChartInputs(bundle).overviewChart, []);
  assert.deepEqual(replayChartInputs(bundle).dexVolumeChart, []);
  const rebuilt = { generatedAt: '2024-01-03T00:00:00.000Z', rawReturnedData: {
    nearDexVolumeHistory: { rows: [{ date: '2024-01-01', valueUsd: 4 }, { date: '2024-01-02', valueUsd: 5 }] },
    nearFeeHistory: { rows: [{ date: '2024-01-01', valueUsd: 1 }, { date: '2024-01-02', valueUsd: 2 }] },
  } };
  assert.equal(replayChartInputs(rebuilt).dexVolumeChart.length, 2);
  assert.equal(replayChartInputs(rebuilt).feeHistoryChart.length, 2);
  assert.throws(() => replayChartInputs({}), /dated evidence/);
});

test('replay preserves selected overview and capital chart windows', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ ms: Date.parse('2026-11-01T00:00:00Z') + i * 86_400_000, value: 100 + i }));
  const result = replayChartInputs({ generatedAt: '2026-11-12T00:00:00Z', chartSelections: { days: 7, metric: 'priceUsd', capitalDays: 7 }, rawTvlRows: rows.map(({ ms, value }) => ({ date: ms / 1000, tvl: value })), rawCoinGeckoMarketChart: { prices: rows.map(({ ms, value }) => [ms, value]), market_caps: rows.map(({ ms, value }) => [ms, value]), total_volumes: rows.map(({ ms, value }) => [ms, value]) } });
  assert.equal(result.overviewPlot.length, 8);
  assert.equal(result.capitalChart.length, 8);
  assert.equal(result.capitalChart[0].date, '2026-11-03');
  assert.equal(result.selections.capitalDays, 7);
});
