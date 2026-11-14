import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignMarketAndTvl,
  assessLiveRisks,
  completeWindowSum,
  completeWindowSumChange,
  dailyChangeRows,
  downgradeStaleRiskFindings,
  formatSignedPercent,
  pearsonCorrelation,
  protocolTvlWindowChange,
  stablecoinSupplyWindowChange,
  summarizeBlock,
  summarizeBlockTransactions,
  summarizeNeardataBlockTransactions,
  summarizeIndexedProtocolConcentration,
  summarizeShardExecution,
  summarizeStablecoinExposure,
  summarizeValidators,
  summarizeWeeklyTurnoverIntensity,
  testHypothesis,
  toUtcDate,
  windowChange,
} from '../src/analytics.js';

const utcSeconds = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
const utcMillis = (date) => Date.parse(`${date}T00:00:00Z`);

function makeReturnSeries(returnsA, returnsB, start = '2026-11-01') {
  const first = Date.parse(`${start}T00:00:00Z`);
  let priceUsd = 100, tvlUsd = 200;
  const rows = [{ date: new Date(first).toISOString().slice(0, 10), priceUsd, tvlUsd }];
  for (let index = 0; index < returnsA.length; index += 1) {
    priceUsd *= 1 + returnsA[index] / 100;
    tvlUsd *= 1 + returnsB[index] / 100;
    rows.push({ date: new Date(first + (index + 1) * 86_400_000).toISOString().slice(0, 10), priceUsd, tvlUsd });
  }
  return rows;
}

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

test('per-block transaction count requires every newly included shard chunk to match the finalized block', () => {
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
    { header: { shard_id: 0, chunk_hash: 'chunk-0', height_included: 224_474_509 }, transactions: [{ hash: 'tx-0' }, { hash: 'tx-1' }] },
    { header: { shard_id: 1, chunk_hash: 'chunk-1', height_included: 224_474_509 }, transactions: [{ hash: 'tx-2' }] },
  ];
  const result = summarizeBlockTransactions(block, chunks);
  assert.equal(result.transactionCount, 3);
  assert.equal(result.chunkCount, 2);
  assert.deepEqual(result.chunks.map((row) => row.transactionCount), [2, 1]);
  assert.equal(summarizeBlockTransactions(block, chunks.slice(1)), null);
  assert.equal(summarizeBlockTransactions(block, [{ ...chunks[0], header: { ...chunks[0].header, chunk_hash: 'wrong' } }, chunks[1]]), null);
  assert.equal(summarizeBlockTransactions(block, [{ ...chunks[0], header: { ...chunks[0].header, height_included: 1 } }, chunks[1]]), null);
  assert.equal(summarizeBlockTransactions(block, [{ ...chunks[0], transactions: null }, chunks[1]]), null);
  assert.equal(summarizeBlockTransactions(block, [{ ...chunks[0], transactions: [{ signer_id: 'missing-hash' }] }, chunks[1]]), null);
});

test('a shard chunk included in an earlier block contributes zero without its old payload', () => {
  const block = {
    height: 100, hash: 'block-100', timestamp: '2026-11-14T06:11:00.000Z',
    chunkRefs: [
      { shardId: 0, chunkHash: 'current-chunk', heightIncluded: 100 },
      { shardId: 1, chunkHash: 'reused-chunk', heightIncluded: 99 },
    ],
  };
  const currentChunk = { header: { shard_id: 0, chunk_hash: 'current-chunk', height_included: 100 }, transactions: [{ hash: 'new-tx' }] };
  const result = summarizeBlockTransactions(block, [currentChunk]);
  assert.equal(result.transactionCount, 1);
  assert.deepEqual(result.chunks.map((chunk) => chunk.transactionCount), [1, 0]);
  const oldChunk = { header: { shard_id: 1, chunk_hash: 'reused-chunk', height_included: 99 }, transactions: [{ hash: 'old-tx' }] };
  assert.equal(summarizeBlockTransactions(block, [currentChunk, oldChunk]).transactionCount, 1);
});

test('Neardata sample validates the exact block and counts prior-height references as zero', () => {
  const block = {
    height: 12, hash: 'block-12', timestamp: '2026-11-14T06:11:00.000Z',
    chunkRefs: [
      { shardId: 0, chunkHash: 'chunk-0', heightIncluded: 12 },
      { shardId: 1, chunkHash: 'chunk-1', heightIncluded: 11 },
    ],
  };
  const payload = {
    block: { header: { height: 12, hash: 'block-12' }, chunks: [
      { shard_id: 0, chunk_hash: 'chunk-0', height_included: 12 },
      { shard_id: 1, chunk_hash: 'chunk-1', height_included: 11 },
    ] },
    shards: [
      { shard_id: 0, chunk: { header: { chunk_hash: 'chunk-0', height_included: 12 }, transactions: [{ transaction: { hash: 'tx-0' } }] } },
      { shard_id: 1 },
    ],
  };
  const result = summarizeNeardataBlockTransactions(block, payload);
  assert.equal(result.transactionCount, 1);
  assert.equal(result.chunkCount, 1);
  assert.equal(result.shardCount, 2);
  assert.equal(result.reusedShardCount, 1);
  assert.deepEqual(result.chunks.map((row) => row.transactionCount), [1, 0]);
  assert.equal(result.rawChunks.length, 1);
  assert.deepEqual(result.rawChunks[0].transactions, [{ hash: 'tx-0' }]);
  assert.equal(summarizeBlockTransactions(block, result.rawChunks).transactionCount, 1);
  const oldPayload = { ...payload, shards: [payload.shards[0], { shard_id: 1, chunk: { header: { chunk_hash: 'chunk-1', height_included: 11 }, transactions: [{ transaction: { hash: 'old-tx' } }] } }] };
  assert.equal(summarizeNeardataBlockTransactions(block, oldPayload).transactionCount, 1);
  assert.equal(summarizeNeardataBlockTransactions(block, { ...payload, block: { ...payload.block, header: { height: 13, hash: 'block-13' } } }), null);
  assert.equal(summarizeNeardataBlockTransactions(block, { ...payload, shards: payload.shards.slice(1) }), null);
  assert.equal(summarizeNeardataBlockTransactions(block, { ...payload, shards: [{ ...payload.shards[0], chunk: { ...payload.shards[0].chunk, header: { chunk_hash: 'wrong', height_included: 12 } } }, payload.shards[1]] }), null);
  assert.equal(summarizeNeardataBlockTransactions(block, { ...payload, shards: [{ ...payload.shards[0], chunk: { ...payload.shards[0].chunk, transactions: [{ transaction: {} }] } }, payload.shards[1]] }), null);
});

test('Flight Recorder reports per-shard composition only for a complete matching transaction sample', () => {
  const block = {
    height: 42, hash: 'block-42', timestamp: '2026-11-14T00:00:00.000Z',
    chunkGas: [
      { shardId: 0, gasUsedTgas: 2, gasUtilizationPct: 20, gasFeeNear: 0.1 },
      { shardId: 1, gasUsedTgas: 6, gasUtilizationPct: 60, gasFeeNear: 0.3 },
      { shardId: 2, gasUsedTgas: 0, gasUtilizationPct: 0, gasFeeNear: 0 },
    ],
  };
  const activity = { blockHeight: 42, blockHash: 'block-42', chunkCount: 2, reusedShardCount: 1, chunks: [
    { shardId: 0, transactionCount: 2 }, { shardId: 1, transactionCount: 4 }, { shardId: 2, transactionCount: 2 },
  ] };
  const result = summarizeShardExecution(block, activity);
  assert.equal(result.transactionSampleVerified, true);
  assert.equal(result.totalTransactions, 8);
  assert.equal(result.usedShards, 2);
  assert.equal(result.shards[0].transactionSharePct, 25);
  assert.equal(result.shards[0].gasSharePct, 25);
  assert.equal(result.shards[1].transactionMinusGasSharePp, -25);
  assert.equal(result.shards[2].transactionSharePct, 25);
  assert.equal(summarizeShardExecution(block, { ...activity, blockHash: 'different-block' }).transactionSampleVerified, false);
  assert.equal(summarizeShardExecution(block, { ...activity, chunks: activity.chunks.slice(1) }).totalTransactions, null);
});

test('weekly turnover intensity requires seven exact, consecutive dates shared by TVL and DEX volume', () => {
  const start = Date.parse('2026-11-01T00:00:00Z');
  const tvlRows = Array.from({ length: 8 }, (_, index) => ({ date: new Date(start + index * 86_400_000).toISOString().slice(0, 10), tvlUsd: 100 }));
  const dexRows = tvlRows.map((row) => ({ date: row.date, valueUsd: 10 }));
  const result = summarizeWeeklyTurnoverIntensity(tvlRows, dexRows, 7, '2026-11-09');
  assert.equal(result.startDate, '2026-11-02');
  assert.equal(result.endDate, '2026-11-08');
  assert.equal(result.totalDexVolumeUsd, 70);
  assert.equal(result.averageTvlUsd, 100);
  assert.equal(result.turnoverPct, 70);
  assert.equal(summarizeWeeklyTurnoverIntensity(tvlRows, dexRows.filter((row) => row.date !== '2026-11-05'), 7, '2026-11-09'), null);
  assert.equal(summarizeWeeklyTurnoverIntensity(tvlRows, dexRows.map((row, index) => index === 4 ? { ...row, date: '2026-11-06' } : row), 7, '2026-11-09'), null);
  assert.equal(summarizeWeeklyTurnoverIntensity(tvlRows, [...dexRows, { ...dexRows[4], valueUsd: 999 }], 7, '2026-11-09'), null);
});

test('indexed TVL concentration and stablecoin exposure remain bounded to valid provider rows', () => {
  const concentration = summarizeIndexedProtocolConcentration([
    { slug: 'a', name: 'A', nearTvlUsd: 60 }, { slug: 'b', name: 'B', nearTvlUsd: 30 },
    { slug: 'c', name: 'C', nearTvlUsd: 10 }, { slug: 'bad', name: 'Bad', nearTvlUsd: -1 },
    { slug: 'a', name: 'Duplicate A', nearTvlUsd: 999 },
  ]);
  assert.equal(concentration.protocolCount, 3);
  assert.equal(concentration.totalIndexedTvlUsd, 100);
  assert.ok(Math.abs(concentration.topThreeSharePct - 100) < 1e-10);
  assert.equal(concentration.hhi, 4600);
  const stablecoins = summarizeStablecoinExposure([
    { id: 'usd', name: 'USD', symbol: 'USD', pegType: 'peggedUSD', priceUsd: 0.99, currentNearCirculationUsd: 90 },
    { id: 'near', name: 'NEAR', pegType: 'peggedEUR', priceUsd: 0.5, currentNearCirculationUsd: 999 },
    { id: 'missing', pegType: 'peggedUSD', priceUsd: null, currentNearCirculationUsd: 100 },
  ]);
  assert.equal(stablecoins.assetCount, 1);
  assert.equal(stablecoins.totalCirculationUsd, 90);
  assert.ok(Math.abs(stablecoins.largestQuoteDeviation.deviationPct - 1) < 1e-10);
  assert.equal(summarizeStablecoinExposure([]), null);
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
    prev_epoch_kickout: [{ account_id: 'kicked.near', reason: { NotEnoughChunkEndorsements: { expected: 43_198, produced: 0 } } }],
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
  assert.deepEqual(result.prevEpochKickouts, [{ accountId: 'kicked.near', reason: 'NotEnoughChunkEndorsements', expected: 43_198, produced: 0 }]);
  assert.equal(result.slashedValidatorCount, 0);
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

test('fee and DEX rolling sums require exact consecutive days and compare adjacent full windows', () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({ date: new Date(Date.parse('2026-01-01T00:00:00Z') + index * 86_400_000).toISOString().slice(0, 10), valueUsd: index + 1 }));
  const recent = completeWindowSum(rows, 'valueUsd', 7);
  assert.equal(recent.sum, 77);
  assert.equal(recent.startDate, '2026-01-08');
  const change = completeWindowSumChange(rows, 'valueUsd', 7);
  assert.equal(change.previous.sum, 28);
  assert.equal(change.current.sum, 77);
  assert.equal(change.changePct, 175);
  rows.splice(8, 1);
  assert.equal(completeWindowSum(rows, 'valueUsd', 7), null);
  assert.equal(completeWindowSumChange(rows, 'valueUsd', 7), null);
  const zeroBase = Array.from({ length: 14 }, (_, index) => ({ date: new Date(Date.parse('2026-02-01T00:00:00Z') + index * 86_400_000).toISOString().slice(0, 10), valueUsd: 0 }));
  assert.equal(completeWindowSumChange(zeroBase, 'valueUsd', 7), null);
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

test('thesis diagnostics count directions without letting a single magnitude set the agreement rate', () => {
  const returnsA = [1, -1, 0, 1, -1, 1, -1];
  const returnsB = [1, 1, 3, -1, -1, 1, 1];
  const result = testHypothesis(makeReturnSeries(returnsA, returnsB), 'priceUsd', 'tvlUsd', 'positive', 7);
  assert.equal(result.diagnostics.directionalAgreement.sameDirectionCount, 3);
  assert.equal(result.diagnostics.directionalAgreement.oppositeDirectionCount, 3);
  assert.equal(result.diagnostics.directionalAgreement.tieCount, 1);
  assert.equal(result.diagnostics.directionalAgreement.agreementPct, 50);
  assert.deepEqual(result.pairedChanges.map((row) => row.date), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);

  const regular = Array.from({ length: 8 }, (_, index) => index + 1);
  const extreme = regular.map((value, index) => index === 7 ? 80 : value);
  const baseline = testHypothesis(makeReturnSeries(regular, regular), 'priceUsd', 'tvlUsd', 'positive', 8);
  const outlier = testHypothesis(makeReturnSeries(regular, extreme), 'priceUsd', 'tvlUsd', 'positive', 8);
  assert.equal(baseline.diagnostics.directionalAgreement.sameDirectionCount, 8);
  assert.equal(outlier.diagnostics.directionalAgreement.sameDirectionCount, 8);
  assert.notEqual(outlier.r, baseline.r);
});

test('leave-one-day-out diagnostics replay from the exact selected pairs and resolve tied influence by UTC date', () => {
  const values = Array.from({ length: 8 }, (_, index) => index + 1);
  const result = testHypothesis(makeReturnSeries(values, values), 'priceUsd', 'tvlUsd', 'positive', 8);
  const loo = result.diagnostics.leaveOneOut;
  assert.equal(loo.exclusions.length, 8);
  assert.equal(loo.undefinedCount, 0);
  assert.equal(loo.minR, 1);
  assert.equal(loo.maxR, 1);
  assert.equal(loo.maxAbsDeltaR, 0);
  assert.equal(loo.mostInfluentialDate, result.pairedChanges[0].date);
  for (const item of loo.exclusions) {
    const replay = pearsonCorrelation(result.pairedChanges.filter((row) => row.date !== item.excludedDate), 'a', 'b').r;
    assert.equal(item.r, replay);
    assert.equal(item.deltaR, replay - result.r);
  }
});

test('stablecoin supply window requires an exact full daily sample and applies the disclosed contraction screen', () => {
  const first = Date.parse('2026-11-01T00:00:00Z');
  const rows = Array.from({ length: 8 }, (_, index) => ({
    date: new Date(first + index * 86_400_000).toISOString().slice(0, 10),
    totalCirculatingPeggedUsd: 100_000_000 - index * 1_500_000,
    totalCirculatingUsdPeggedUsd: 99_000_000 - index * 1_400_000,
    totalMintedUsdPeggedUsd: 120_000_000,
  }));
  const change = stablecoinSupplyWindowChange(rows, 7, '2026-11-10');
  assert.equal(change.startDate, '2026-11-01');
  assert.equal(change.endDate, '2026-11-08');
  assert.ok(Math.abs(change.changePct - (-10.5)) < 1e-9);
  const risk = assessLiveRisks({ stablecoinSupply7d: change }).find((item) => item.id === 'stablecoin-supply-contraction');
  assert.equal(risk.active, true);
  assert.equal(risk.tone, 'high');
  assert.match(risk.query, /stablecoincharts\/Near/);
  assert.match(risk.impact, /does not prove user withdrawals/);
  assert.deepEqual(risk.sourceIds, ['defillama-near-stablecoin-history']);
  assert.equal(stablecoinSupplyWindowChange(rows.slice(1), 7, '2026-11-10'), null);
  assert.equal(stablecoinSupplyWindowChange([...rows, rows.at(-1)], 7, '2026-11-10'), null);
  const currentDateOnly = [...rows.slice(0, 7), { ...rows.at(-1), date: '2026-11-10' }];
  assert.equal(stablecoinSupplyWindowChange(currentDateOnly, 7, '2026-11-10'), null);
});

test('risk threshold flags only configured live price/TVL signals and omits unobserved indicators', () => {
  const risks = assessLiveRisks({
    market: { priceChange24h: -21 },
    tvl7d: { changePct: -5, days: 7 },
    tvl30d: { changePct: -25, days: 30 },
    validators: { validatorCount: 3, top10SharePct: 80, hhi: 4000 },
    block: { height: 42, ageSeconds: 12, gasUsed: 10_000_000_000_000, estimatedGasFeeNear: 0.001 },
    rpcStatus: { chain_id: 'mainnet', syncing: false },
    declineThreshold: 20,
  });
  assert.equal(risks.length, 4);
  assert.equal(risks.find((item) => item.id === 'capital').state, 'Drawdown watch');
  assert.equal(risks.find((item) => item.id === 'economics').state, 'Price decline watch');
  assert.equal(risks.find((item) => item.id === 'infrastructure').state, 'Finalized block observed');
  assert.equal(risks.some((item) => item.id === 'dependencies'), false);
  assert.ok(risks.every((item) => ['severity', 'trend', 'confidence', 'evidence', 'impact', 'next'].every((field) => typeof item[field] === 'string' && item[field].length > 0)));

  const gaps = assessLiveRisks({ market: null, tvl7d: null, tvl30d: null, validators: null, block: null, rpcStatus: null });
  assert.deepEqual(gaps, []);
  const incompleteRpc = assessLiveRisks({ block: { height: 42 }, rpcStatus: { chain_id: 'mainnet' } });
  assert.equal(incompleteRpc.some((item) => item.id === 'infrastructure'), false);
});

test('stale threshold findings remain visible as context but do not count as active alerts', () => {
  const risk = { id: 'test-risk', active: true, tone: 'high', state: 'Threshold crossed', severity: 'High', sourceIds: ['old-source'], requiredSourceIds: ['old-source'] };
  const definitions = [
    { id: 'old-source', name: 'Old source', staleAfterSeconds: 3600 },
    { id: 'fresh-source', name: 'Fresh source', staleAfterSeconds: 3600 },
  ];
  const asOf = Date.parse('2026-11-14T12:00:00Z');
  const old = [{ sourceId: 'old-source', checkedAt: '2026-11-14T09:00:00Z', providerAt: '2026-11-14T09:00:00Z' }];
  const downgraded = downgradeStaleRiskFindings([risk], old, definitions, asOf)[0];
  assert.equal(downgraded.active, false);
  assert.equal(downgraded.tone, 'caution');
  assert.match(downgraded.state, /^Stale observation/);
  assert.match(downgraded.severity, /not counted as a live finding/);
  assert.equal(downgradeStaleRiskFindings([risk], [{ ...old[0], providerAt: '2026-11-14T11:30:00Z' }], definitions, asOf)[0].active, true);
  const multiSource = { ...risk, sourceIds: ['old-source', 'fresh-source'], requiredSourceIds: ['old-source', 'fresh-source'] };
  assert.equal(downgradeStaleRiskFindings([multiSource], [...old, { sourceId: 'fresh-source', checkedAt: '2026-11-14T11:30:00Z' }], definitions, asOf)[0].active, false);
  const optionalContext = { ...risk, sourceIds: ['old-source', 'fresh-source'], requiredSourceIds: ['fresh-source'] };
  assert.equal(downgradeStaleRiskFindings([optionalContext], [...old, { sourceId: 'fresh-source', checkedAt: '2026-11-14T11:30:00Z' }], definitions, asOf)[0].active, true);
});

test('stablecoin risk requires an observed USD peg and current NEAR circulation, with token exposure disclosed', () => {
  const risks = assessLiveRisks({ nearStablecoins: { assets: [
    { id: 'usn', name: 'USN', symbol: 'USN', pegType: 'peggedUSD', priceUsd: 0.08625988408, priceSource: 'defillama', currentNearCirculationUsd: 69_854 },
    { id: 'usdc', name: 'USD Coin', symbol: 'USDC', pegType: 'peggedUSD', priceUsd: 0.9999, priceSource: 'defillama', currentNearCirculationUsd: 91_841_030 },
  ] } });
  const risk = risks.find((item) => item.id === 'stablecoin-depeg-usn');
  assert.equal(risk.tone, 'critical');
  assert.match(risk.severity, /Critical.*91\.4%/);
  assert.match(risk.evidence, /\$0\.086260/);
  assert.match(risk.evidence, /\$69,854/);
  assert.match(risk.evidence, /of USD-pegged NEAR circulation/);
  assert.match(risk.confidence, /no provider price timestamp/);
  assert.deepEqual(risk.sourceIds, ['defillama-near-stablecoins']);
});

test('moderate stablecoin deviation requires two timestamped checks; a one-sample small move is not alerted', () => {
  const checkedAt = new Date().toISOString();
  const asset = { id: 'test-usd', name: 'Test USD', symbol: 'TUSD', pegType: 'peggedUSD', priceUsd: 0.98, priceSource: 'defillama', currentNearCirculationUsd: 10_000 };
  const oneSample = assessLiveRisks({ nearStablecoins: { assets: [asset] }, stablecoinHistory: { 'test-usd': [{ checkedAt, priceUsd: 0.98 }] } });
  assert.equal(oneSample.some((item) => item.id === 'stablecoin-depeg-test-usd'), false);
  const twoSamples = assessLiveRisks({ nearStablecoins: { assets: [asset] }, stablecoinHistory: { 'test-usd': [
    { checkedAt: new Date(Date.now() - 60 * 60_000).toISOString(), priceUsd: 0.98 }, { checkedAt, priceUsd: 0.98 },
  ] } });
  assert.equal(twoSamples.find((item) => item.id === 'stablecoin-depeg-test-usd')?.tone, 'caution');
});

test('protocol TVL risk uses dated NEAR-chain points and refuses unsupported windows', () => {
  const latest = Math.floor(Date.now() / 1000);
  const points = Array.from({ length: 8 }, (_, index) => ({ date: latest - (7 - index) * 86_400, totalLiquidityUsd: 100_000_000 - index * 5_000_000 }));
  const week = protocolTvlWindowChange(points, 7);
  assert.ok(Math.abs(week.changePct - (-35)) < 0.01);
  const risks = assessLiveRisks({ nearProtocolTvls: { protocols: [{ slug: 'near-lend', name: 'NEAR Lend', category: 'Lending', nearTvlUsd: 65_000_000, points }] } });
  const risk = risks.find((item) => item.id === 'protocol-tvl-near-lend');
  assert.equal(risk.tone, 'high');
  assert.match(risk.evidence, /NEAR-chain TVL changed/);
  assert.match(risk.evidence, /not proven net withdrawals/);
  assert.match(risk.query, /chainTvls\.Near\.tvl/);
  const severePoints = points.map((point, index) => ({ ...point, totalLiquidityUsd: index < 6 ? 100_000_000 - index * 8_000_000 : index === 6 ? 50_000_000 : 37_500_000 }));
  const severe = assessLiveRisks({ nearProtocolTvls: { protocols: [{ slug: 'near-lend', name: 'NEAR Lend', nearTvlUsd: 37_500_000, points: severePoints }] } }).find((item) => item.id === 'protocol-tvl-near-lend');
  assert.equal(severe.tone, 'critical');
  assert.match(severe.severity, /-62\.5% over 7\.0 days/);
  assert.equal(protocolTvlWindowChange([{ date: latest, totalLiquidityUsd: 100 }, { date: latest - 5 * 86_400, totalLiquidityUsd: 50 }], 1), null);
});

test('activity context reports one verified block sample without claiming user adoption or retention', () => {
  const risks = assessLiveRisks({ blockActivity: { transactionCount: 12_345, blockHeight: 224_474_509, chunkCount: 10, blockTimestamp: '2026-11-14T06:11:00.000Z' } });
  const activity = risks.find((item) => item.id === 'activity');
  assert.equal(activity.state, 'One finalized block observed');
  assert.match(activity.severity, /not an adoption-risk score/);
  assert.match(activity.trend, /no daily or unique-user trend/);
  assert.match(activity.evidence, /12,345 transactions/);
  assert.match(activity.confidence, /does not measure users/);
});

test('market watch evidence contains the actual price change and timestamp, not just gas context', () => {
  const risks = assessLiveRisks({
    market: { priceChange24h: -21.25, priceUsd: 3.12, timestamp: '2026-11-14T12:00:00.000Z' },
    block: { height: 42, ageSeconds: 12, estimatedGasFeeNear: 0.001 },
    rpcStatus: { chain_id: 'mainnet', syncing: false },
  });
  const market = risks.find((item) => item.id === 'economics');
  assert.match(market.evidence, /CoinGecko reported NEAR at \$3\.1200 -21\.25% over 24 hours/);
  assert.match(market.evidence, /2026-11-14T12:00:00\.000Z/);
  assert.match(market.evidence, /separate execution-cost context/);
  assert.doesNotMatch(market.evidence, /gas cost was.*only evidence/i);
});

test('signed percentage formatter preserves direction and reports missing values', () => {
  assert.equal(formatSignedPercent(12.345), '+12.3%');
  assert.equal(formatSignedPercent(-5), '-5.0%');
  assert.equal(formatSignedPercent(null), 'Unavailable');
});
