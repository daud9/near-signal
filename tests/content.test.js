import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const label = 'NEAR price and TVL daily changes move in the same direction';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rebuild = readFileSync(new URL('../scripts/rebuild-data.mjs', import.meta.url), 'utf8');
const thesis = readFileSync(new URL('../THESIS.md', import.meta.url), 'utf8');
const snapshot = JSON.parse(readFileSync(new URL('../data/latest-evidence.json', import.meta.url), 'utf8'));

test('dashboard, rebuild and latest evidence use the same non-bullish co-movement label', () => {
  assert.ok(html.includes(`value="${label}"`));
  assert.ok(rebuild.includes(`claimLabel: '${label}'`));
  assert.equal(snapshot.selectedDescriptiveTest.claimLabel, label);
});

test('priority tools keep methods and sources inside the thesis engine without a standalone methodology UI', () => {
  assert.ok(html.indexOf('href="#thesis-challenge"') < html.indexOf('href="#risk-radar"'));
  assert.ok(html.includes('id="thesisProvenance"'));
  assert.ok(html.includes('id="thesisSourceQuery"'));
  assert.ok(html.includes('id="thesisMethodList"'));
  assert.ok(!html.includes('id="methodology"'));
  assert.ok(!html.includes('href="#methodology"'));
  assert.ok(thesis.includes('## Methodology and connected data sources'));
  assert.ok(thesis.includes('## What is unknown or cuts against the hypothesis'));
});

test('overview exposes direct links to the two priority analysis features', () => {
  assert.ok(html.includes('href="#thesis-challenge">Challenge the thesis</a>'));
  assert.ok(html.includes('href="#risk-radar">Open risk radar</a>'));
  assert.ok(!html.includes('Composite health score unavailable'));
});
