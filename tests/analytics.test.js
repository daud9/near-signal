import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignMarketAndTvl,
  assessLiveRisks,
  dailyChangeRows,
  formatSignedPercent,
  pearsonCorrelation,
  summarizeBlock,
  summarizeBlockTransactions,
  summarizeValidators,
  testHypothesis,
  toUtcDate,
  windowChange,
} from '../src/analytics.js';

const utcSeconds = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
const utcMillis = (date) => Date.parse(`${date}T00:00:00Z`);

function makeSeries(length = 40, start = '2026-10-01') {
  const first = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length }, (_, index) => {
    const date = new Date(first + index * 86_400_000).toISOString().slice(0, 10);
    const price = 3 + index * 0.03;
    return { date, priceUsd: price, tvlUsd: 100 + index, grossVolumeUsd: 1000 + index * 5 };
  });
}

test('daily TVL and market join uses exact UTC dates and excludes the current partial date', () => {
  const tvlRows = ['2026-11-10', '2026-11-11', '2026-11-13', '2026-11-14'].map((date, index) => ({ date: utcSeconds(date), tvl: 100 + index }));
  const marketChart = { prices: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map((date, index) => [utcMillis(date), 3 + index]) };
  const rows = alignMarketAndTvl(tvlRows, marketChart, '2026-11-14');
  assert.deepEqual(rows.map((row) => row.date), ['2026-11-10', '2026-11-11', '2026-11-13']);
  assert.equal(rows[2].tvlUsd, 102);
  assert.equal(rows[2].priceUsd, 6);
  assert.equal(rows.some((row) => row.date === '2026-11-14'), false);
  assert.equal(toUtcDate(null), null);
  assert.equal(toUtcDate(''), null);
  assert.equal(toUtcDate('   '), null);
  assert.equal(toUtcDate(false), null);
  assert.deepEqual(alignMarketAndTvl([{ date: null, tvl: 999 }], { prices: [[null, 3]] }, '2026-11-14'), []);
});

test('latest finalized block fee estimate sums chunk gas and applies block gas price', () => {
  const blockDate = '2026-01-01T00:00:00Z';
  const blockTimeNs = String(BigInt(Date.parse(blockDate)) * 1_000_000n);
  const block = {
    header: { height: 12, hash: 'test-hash', epoch_id: 'epoch-a', timestamp: blockTimeNs, gas_price: '100000000' },
    chunks: [
      { gas_used: '4000000000000', gas_limit: '10000000000000' },
      { gas_used: '6000000000000', gas_limit: '10000000000000' },
    ],
  };
  const result = summarizeBlock(block, Date.parse(blockDate) + 10_000);
  assert.equal(result.height, 12);
  assert.equal(result.chunkCount, 2);
  assert.equal(result.activeChunks, 2);
  assert.equal(result.gasUsed, 10_000_000_000_000);
  assert.equal(result.gasUtilizationPct, 50);
  assert.equal(result.ageSeconds, 10);
  assert.equal(result.gasPriceNearPerTgas, 0.0001);
  assert.ok(Math.abs(result.estimatedGasFeeNear - 0.001) < 1e-12);
});

test('per-block transaction count requires every shard chunk to match the finalized block', () => {
  const block = {
    height: 224_474_509,
    hash: 'block-hash',
    timestamp: '2026-11-14T06:11:00.000Z',
    chunkRefs: [
      { shardId: 0, chunkHash: 'chunk-0' },
      { shardId: 1, chunkHash: 'chunk-1' },
    ],
  };
  const chunks = [
    { header: { shard_id: 0, chunk_hash: 'chunk-0', height_included: 224_474_509 }, transactions: [{}, {}] },
    { header: { shard_id: 1, chunk_hash: 'chunk-1', height_included: 224_474_509 }, transactions: [{}] },
  ];
  const result = summarizeBlockTransactions(block, chunks);
  assert.equal(result.transactionCount, 3);
  assert.equal(result.chunkCount, 2);
  assert.deepEqual(result.chunks.map((row) => row.transactionCount), [2, 1]);
  assert.equal(summarizeBlockTransactions(block, chunks.slice(1)), null);
  assert.equal(summarizeBlockTransactions(block, [{ ...chunks[0], header: { ...chunks[0].header, chunk_hash: 'wrong' } }, chunks[1]]), null);
  assert.equal(summarizeBlockTransactions(block, [{ ...chunks[0], header: { ...chunks[0].header, height_included: 1 } }, chunks[1]]), null);
  assert.equal(summarizeBlockTransactions(block, [{ ...chunks[0], transactions: null }, chunks[1]]), null);
});

test('missing block gas fields are unavailable rather than silently treated as zero', () => {
  const result = summarizeBlock({ header: { height: 1, timestamp: '1767225600000000000', gas_price: '100000000' }, chunks: [{ gas_limit: '1000' }] });
  assert.equal(result, null);
  assert.equal(summarizeBlock({ header: { height: 1, timestamp: '1767225600000000000', gas_price: 'bad' }, chunks: [{ gas_used: '1', gas_limit: '1000' }] }), null);
  assert.equal(summarizeBlock({ header: { height: 1, timestamp: '1767225600000000000', gas_price: '100000000' }, chunks: [{ gas_used: '1001', gas_limit: '1000' }] }), null);
});

test('validator concentration uses the RPC current set stake weights and reports epoch counters', () => {
  const yocto = 10n ** 24n;
  const result = summarizeValidators({
    epoch_height: 50,
    current_validators: [
      { account_id: 'a.near', stake: String(50n * yocto), num_produced_blocks: 30, num_expected_blocks: 40 },
      { account_id: 'b.near', stake: String(30n * yocto), num_produced_blocks: 35, num_expected_blocks: 35 },
      { account_id: 'c.near', stake: String(20n * yocto), num_produced_blocks: 25, num_expected_blocks: 25 },
    ],
    next_validators: [{ account_id: 'next.near' }],
  });
  assert.equal(result.validatorCount, 3);
  assert.equal(result.nextValidatorCount, 1);
  assert.ok(Math.abs(result.totalStakeNear - 100) < 1e-9);
  assert.equal(result.top1SharePct, 50);
  assert.equal(result.top10SharePct, 100);
  assert.equal(result.hhi, 3800);
  assert.equal(result.producedBlocks, 90);
  assert.equal(result.expectedBlocks, 100);
  assert.equal(result.blockProductionPct, 90);
  assert.equal(summarizeValidators({ current_validators: [{ account_id: 'bad.near', stake: 'invalid' }] }), null);
  const noCounters = summarizeValidators({ current_validators: [{ account_id: 'a.near', stake: String(yocto) }] });
  assert.equal(noCounters.producedBlocks, null);
  assert.equal(noCounters.expectedBlocks, null);
  assert.equal(noCounters.blockProductionPct, null);
});

test('a 7-day change needs eight consecutive complete daily snapshots', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ date: new Date(Date.parse('2026-01-01T00:00:00Z') + index * 86_400_000).toISOString().slice(0, 10), tvlUsd: 100 + index * 10 }));
  const result = windowChange(rows, 'tvlUsd', 7);
  assert.equal(result.days, 7);
  assert.equal(result.startValue, 100);
  assert.equal(result.endValue, 170);
  assert.equal(result.changePct, 70);
  assert.equal(windowChange(rows.slice(1), 'tvlUsd', 7), null);
});

test('daily window calculation rejects a gap even when the first and last dates span the requested length', () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({ date: new Date(Date.parse('2026-01-01T00:00:00Z') + index * 86_400_000).toISOString().slice(0, 10), tvlUsd: 100 + index }));
  rows.splice(4, 1);
  assert.equal(windowChange(rows, 'tvlUsd', 7), null);
  assert.equal(windowChange(rows, 'tvlUsd', 30), null);
});

test('daily percentage-change rows skip dates separated by a gap', () => {
  const rows = [
    { date: '2026-01-01', priceUsd: 100 },
    { date: '2026-01-02', priceUsd: 110 },
    { date: '2026-01-04', priceUsd: 121 },
    { date: '2026-01-05', priceUsd: 133.1 },
  ];
  assert.deepEqual(dailyChangeRows(rows, 'priceUsd').map((row) => row.date), ['2026-01-02', '2026-01-05']);
  assert.equal(dailyChangeRows(rows, 'priceUsd')[0].value, 10);
  assert.ok(Math.abs(dailyChangeRows(rows, 'priceUsd')[1].value - 10) < 1e-10);
});

test('Pearson correlation handles positive, negative, short and constant samples', () => {
  const positive = pearsonCorrelation([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }], 'x', 'y');
  const negative = pearsonCorrelation([{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 2 }], 'x', 'y');
  const short = pearsonCorrelation([{ x: 1, y: 2 }, { x: 2, y: 4 }], 'x', 'y');
  const constant = pearsonCorrelation([{ x: 1, y: 2 }, { x: 1, y: 4 }, { x: 1, y: 8 }], 'x', 'y');
  assert.equal(positive.r, 1);
  assert.equal(negative.r, -1);
  assert.equal(short.r, null);
  assert.equal(constant.r, null);
});

test('hypothesis test returns a transparent direction-based verdict on full matched windows', () => {
  const positiveRows = makeSeries(22);
  const positive = testHypothesis(positiveRows, 'priceUsd', 'tvlUsd', 'positive', 14);
  assert.equal(positive.verdict, 'Supported by available evidence');
  assert.equal(positive.n, 14);
  assert.ok(positive.r >= 0.3);
  assert.match(positive.summary, /not causation|not causal/i);

  const inverseRows = positiveRows.map((row, index) => ({ ...row, tvlUsd: 1000 / row.priceUsd }));
  const negative = testHypothesis(inverseRows, 'priceUsd', 'tvlUsd', 'positive', 14);
  assert.equal(negative.verdict, 'Not supported');
  assert.ok(negative.r <= -0.3);

  const incomplete = testHypothesis(makeSeries(10), 'priceUsd', 'tvlUsd', 'positive', 14);
  assert.equal(incomplete.verdict, 'Insufficient evidence');
  assert.equal(incomplete.r, null);
});

test('hypothesis test does not bridge missing dates to fill the selected window', () => {
  const rows = makeSeries(22);
  rows.splice(10, 1);
  const result = testHypothesis(rows, 'priceUsd', 'tvlUsd', 'positive', 14);
  assert.equal(result.verdict, 'Insufficient evidence');
});

test('risk threshold flags only the configured price/TVL signals and keeps missing domains unavailable', () => {
  const risks = assessLiveRisks({
    market: { priceChange24h: -21 },
    tvl7d: { changePct: -5, days: 7 },
    tvl30d: { changePct: -25, days: 30 },
    validators: { validatorCount: 3, top10SharePct: 80, hhi: 4000 },
    block: { height: 42, ageSeconds: 12, gasUsed: 10_000_000_000_000, estimatedGasFeeNear: 0.001 },
    rpcStatus: { chain_id: 'mainnet', syncing: false },
    declineThreshold: 20,
  });
  assert.equal(risks.length, 6);
  assert.equal(risks.find((item) => item.id === 'capital').state, 'Drawdown watch');
  assert.equal(risks.find((item) => item.id === 'economics').state, 'Price decline watch');
  assert.equal(risks.find((item) => item.id === 'infrastructure').state, 'Finalized block observed');
  assert.equal(risks.find((item) => item.id === 'adoption').state, 'Not measured');
  assert.ok(risks.every((item) => ['severity', 'trend', 'confidence', 'evidence', 'impact', 'next'].every((field) => typeof item[field] === 'string' && item[field].length > 0)));

  const gaps = assessLiveRisks({ market: null, tvl7d: null, tvl30d: null, validators: null, block: null, rpcStatus: null });
  assert.equal(gaps.find((item) => item.id === 'capital').state, 'Daily TVL unavailable');
  assert.equal(gaps.find((item) => item.id === 'infrastructure').state, 'RPC observation unavailable');
  assert.equal(gaps.find((item) => item.id === 'economics').state, 'Market change unavailable');
});

test('activity risk reports one block sample while withholding user adoption and retention claims', () => {
  const risks = assessLiveRisks({ blockActivity: { transactionCount: 12_345, blockHeight: 224_474_509, chunkCount: 10, blockTimestamp: '2026-11-14T06:11:00.000Z' } });
  const adoption = risks.find((item) => item.id === 'adoption');
  assert.match(adoption.state, /adoption unmeasured/);
  assert.match(adoption.severity, /cannot establish user adoption/);
  assert.match(adoption.trend, /no daily or unique-user trend/);
  assert.match(adoption.evidence, /12,345 transactions/);
  assert.match(adoption.confidence, /insufficient for adoption/);
});

test('signed percentage formatter preserves direction and reports missing values', () => {
  assert.equal(formatSignedPercent(12.345), '+12.3%');
  assert.equal(formatSignedPercent(-5), '-5.0%');
  assert.equal(formatSignedPercent(null), 'Unavailable');
});
