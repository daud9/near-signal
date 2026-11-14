import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, resolveWorkspace, isNearAccountId, estimateExecutionCost, toCsv } from '../src/workspace.js';

test('workspace routes prioritize thesis and risk, omit methodology, and resolve unknown hashes safely', () => {
  assert.equal(Object.keys(WORKSPACES).length, 6);
  assert.deepEqual(Object.keys(WORKSPACES).slice(1, 3), ['thesis-challenge', 'risk-radar']);
  for (const route of ['value-capture', 'adoption', 'risk-radar', 'capital-flows', 'thesis-challenge']) assert.equal(resolveWorkspace(`#${route}`), route);
  assert.equal(resolveWorkspace('#methodology'), 'overview');
  assert.equal(resolveWorkspace('#unknown'), 'overview');
  assert.equal(resolveWorkspace('#__proto__'), 'overview');
});
test('NEAR account validation rejects unsafe and malformed IDs', () => {
  for (const id of ['intents.near', 'alice-2.near', 'a'.repeat(64)]) assert.equal(isNearAccountId(id), true);
  for (const id of ['x', 'UPPER.near', "x';DROP TABLE x", '.bad.near', 'bad..near', 'bad_.near', 'a'.repeat(65)]) assert.equal(isNearAccountId(id), false);
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
