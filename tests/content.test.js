import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const label = 'NEAR price and TVL daily changes move in the same direction';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rebuild = readFileSync(new URL('../scripts/rebuild-data.mjs', import.meta.url), 'utf8');
const snapshot = JSON.parse(readFileSync(new URL('../data/latest-evidence.json', import.meta.url), 'utf8'));

test('dashboard, rebuild and latest evidence use the same non-bullish co-movement label', () => {
  assert.ok(html.includes(`value="${label}"`));
  assert.ok(rebuild.includes(`claimLabel: '${label}'`));
  assert.equal(snapshot.selectedDescriptiveTest.claimLabel, label);
});
