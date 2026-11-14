import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, resolveWorkspace, isNearAccountId, buildActivitySql, estimateExecutionCost, toCsv } from '../src/workspace.js';

test('sidebar routes cover the five modules and resolve unknown hashes safely', () => {
  assert.equal(Object.keys(WORKSPACES).length, 7);
  for (const route of ['value-capture', 'adoption', 'risk-radar', 'capital-flows', 'thesis-challenge']) assert.equal(resolveWorkspace(`#${route}`), route);
  assert.equal(resolveWorkspace('#unknown'), 'overview');
  assert.equal(resolveWorkspace('#__proto__'), 'overview');
});
test('NEAR account validation rejects unsafe and malformed IDs', () => {
  for (const id of ['intents.near', 'alice-2.near', 'a'.repeat(64)]) assert.equal(isNearAccountId(id), true);
  for (const id of ['x', 'UPPER.near', "x';DROP TABLE x", '.bad.near', 'bad..near', 'bad_.near', 'a'.repeat(65)]) assert.equal(isNearAccountId(id), false);
});
test('SQL builder generates local date-bounded queries without executable browser requests', () => {
  const sql = buildActivitySql({ startDate: '2026-11-01', endDate: '2026-11-07', contractId: 'intents.near' });
  assert.match(sql, /DECLARE start_date DATE DEFAULT DATE '2026-11-01'/);
  assert.match(sql, /DECLARE contract_account_id STRING DEFAULT 'intents.near'/);
  assert.equal((sql.match(/WHERE (?:ra\.)?block_date >= start_date AND (?:ra\.)?block_date < end_date/g) || []).length, 3);
  assert.match(sql, /DECLARE end_date DATE DEFAULT DATE '2026-11-08'/);
  assert.ok(!sql.includes('@start_date'));
  assert.throws(() => buildActivitySql({ startDate: '2026-02-30', endDate: '2026-03-01', contractId: 'intents.near' }));
  assert.throws(() => buildActivitySql({ startDate: '2026-01-01', endDate: '2026-02-01', contractId: 'intents.near' }));
  assert.throws(() => buildActivitySql({ startDate: '2026-11-07', endDate: '2026-11-01', contractId: 'intents.near' }));
  assert.throws(() => buildActivitySql({ startDate: '2026-11-01', endDate: '2026-11-07', contractId: "x';--" }));
});
test('execution calculator uses supplied live gas price and never invents a market price', () => {
  assert.deepEqual(estimateExecutionCost(100, 0.0001, 3), { gasTgas: 100, near: 0.01, usd: 0.03 });
  assert.equal(estimateExecutionCost(100, null, 3), null);
  assert.equal(estimateExecutionCost(100, 0.0001, null).usd, null);
  for (const gas of [0, -1, 301, NaN]) assert.equal(estimateExecutionCost(gas, 0.0001, 3), null);
});
test('chart CSV preserves exact source values, dates and escaping', () => {
  assert.equal(toCsv([{ date: '2026-11-01', value: 1.23456789 }], 'value "USD"'), '"observed_at_utc","value ""USD"""\n"2026-11-01","1.23456789"\n');
});
