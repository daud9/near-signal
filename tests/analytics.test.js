import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessRisk,
  compareWindows,
  nearHealthCoverage,
  normalizeDailyRows,
  pearsonCorrelation,
  signerConcentration,
  testAdoptionHypothesis,
} from '../src/analytics.js';

function day(date, txns, activeAccounts, overrides = {}) {
  return {
    date,
    txns,
    activeAccounts,
    activeContracts: 4,
    feesNear: 0.5,
    indexedVolumeNear: 25,
    receipts: 2,
    ...overrides,
  };
}

const sixContinuousDays = [
  day('2026-01-01', 1, 10),
  day('2026-01-02', 2, 20),
  day('2026-01-03', 3, 30),
  day('2026-01-04', 4, 40),
  day('2026-01-05', 5, 50),
  day('2026-01-06', 6, 60),
];

test('daily join keeps only dated rows present in both sources and excludes current UTC day', () => {
  const tx = [
    { date: '2026-01-01', txns: '12', txn_fee: '1.25', txn_volume: '10' },
    { date: '2026-01-02', txns: '14', txn_fee: '1.5', txn_volume: '12' },
    { date: '2026-01-03', txns: '99', txn_fee: '2', txn_volume: '20' },
    { date: '2026-01-04', txns: '18', txn_fee: '3', txn_volume: '24' },
  ];
  const accounts = [
    { date: '2026-01-01', active_accounts: 10, active_contracts: 4 },
    { date: '2026-01-02', active_accounts: 11, active_contracts: 5 },
    { date: '2026-01-03', active_accounts: null, active_contracts: 6 },
    { date: '2026-01-04', active_accounts: 14, active_contracts: 7 },
  ];
  const joined = normalizeDailyRows(tx, accounts, '2026-01-04');
  assert.deepEqual(joined.map((row) => row.date), ['2026-01-01', '2026-01-02']);
  assert.equal(joined[0].feesNear, 1.25);
  assert.equal(joined[1].activeAccounts, 11);
});

test('matched-period means and percentage changes use contiguous complete windows', () => {
  const result = compareWindows(sixContinuousDays, 3);
  assert.equal(result.ready, true);
  assert.equal(result.currentReady, true);
  assert.equal(result.currentMeans.txns, 5);
  assert.equal(result.priorMeans.txns, 2);
  assert.equal(result.changes.txns, 150);
  assert.equal(result.txnsPerActiveAccountCurrent, 0.1);
});

test('a date gap invalidates the matched comparison instead of being silently bridged', () => {
  const rows = [
    day('2026-01-01', 1, 10),
    day('2026-01-02', 2, 20),
    day('2026-01-04', 3, 30),
    day('2026-01-05', 4, 40),
    day('2026-01-06', 5, 50),
    day('2026-01-07', 6, 60),
  ];
  const result = compareWindows(rows, 3);
  assert.equal(result.currentReady, true);
  assert.equal(result.ready, false);
  assert.equal(result.changes.txns, null);
  assert.equal(result.txnsPerActiveAccountChange, null);
});

test('metric means are null when any value in that window is missing', () => {
  const rows = sixContinuousDays.map((row, index) => index === 4 ? { ...row, feesNear: null } : row);
  const result = compareWindows(rows, 3);
  assert.equal(result.ready, true);
  assert.equal(result.currentMeans.feesNear, null);
  assert.equal(result.changes.feesNear, null);
});

test('signer HHI is reproducible and explicitly based on the supplied sample', () => {
  const result = signerConcentration([
    { signer_account_id: 'a.near' },
    { signer_account_id: 'a.near' },
    { signer_account_id: 'b.near' },
    { signer_account_id: 'b.near' },
  ]);
  assert.equal(result.sampleSize, 4);
  assert.equal(result.uniqueSigners, 2);
  assert.equal(result.topShare, 0.5);
  assert.equal(result.hhi, 5000);
});

test('Pearson correlation returns the expected values and declines undersized samples', () => {
  const positive = pearsonCorrelation([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }], 'x', 'y');
  const negative = pearsonCorrelation([{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 2 }], 'x', 'y');
  const short = pearsonCorrelation([{ x: 1, y: 2 }, { x: 2, y: 4 }], 'x', 'y');
  assert.equal(positive.r, 1);
  assert.equal(negative.r, -1);
  assert.equal(short.r, null);
});

test('risk alerts respect configurable thresholds and keep missing capital data as a data gap', () => {
  const comparison = compareWindows([
    day('2026-01-01', 10, 100), day('2026-01-02', 10, 100),
    day('2026-01-03', 10, 100), day('2026-01-04', 7, 70),
    day('2026-01-05', 7, 70), day('2026-01-06', 7, 70),
  ], 3);
  const risks = assessRisk(comparison, signerConcentration([]), null, 20);
  assert.equal(risks.find((item) => item.id === 'adoption').state, 'Decline alert');
  assert.equal(risks.find((item) => item.id === 'economics').state, 'Observed');
  assert.equal(risks.find((item) => item.id === 'capital').state, 'Data gap');
  assert.equal(risks.find((item) => item.id === 'infrastructure').state, 'RPC unavailable');
  assert.equal(risks.length, 6);
  assert.ok(risks.every((item) => ['severity', 'trend', 'confidence'].every((field) => typeof item[field] === 'string' && item[field].length > 0)));
});

test('NEHS coverage distinguishes daily evidence from missing domains and a single RPC snapshot', () => {
  const comparison = compareWindows(sixContinuousDays, 3);
  const coverage = nearHealthCoverage(comparison, signerConcentration([]), { chain_id: 'mainnet' });
  assert.equal(coverage.measured, 3);
  assert.deepEqual(coverage.components, [true, true, false, false, true]);
});

test('hypothesis verdict is tied to explicit metrics and discloses association limits', () => {
  const comparison = compareWindows(sixContinuousDays, 3);
  const result = testAdoptionHypothesis(comparison, { r: 0.9, n: 6 });
  assert.equal(result.verdict, 'Supported by available evidence');
  assert.match(result.details[0], /not causal/);
  const insufficient = testAdoptionHypothesis(comparison, { r: null, n: 2 });
  assert.equal(insufficient.verdict, 'Insufficient evidence');
});
