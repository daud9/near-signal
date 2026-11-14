import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CHART_QUERY_RECIPES, THESIS_TEST_RECIPE } from '../src/query-registry.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../src/workspace.js', import.meta.url), 'utf8');

test('each dashboard chart exposes its query, rebuild rule and plain-language meaning', () => {
  for (const chartId of ['overviewChart', 'gasChart', 'blockTxChart', 'capitalChart', 'dexVolumeChart', 'feeHistoryChart']) {
    const recipe = CHART_QUERY_RECIPES[chartId];
    assert.ok(recipe?.source && recipe?.query && recipe?.plainLanguage, `Missing recipe for ${chartId}`);
    assert.ok(html.includes(`id="${chartId}"`));
    assert.ok(app.includes('chartQueryDisclosure(container.id)'));
  }
  assert.ok(CHART_QUERY_RECIPES.dexVolumeChart.query.includes('/overview/dexs/Near'));
  assert.ok(CHART_QUERY_RECIPES.feeHistoryChart.query.includes('/overview/fees/Near'));
  assert.ok(CHART_QUERY_RECIPES.capitalChart.query.includes('/v2/historicalChainTvl/near'));
  assert.ok(!CHART_QUERY_RECIPES.capitalChart.query.includes('coingecko.com'));
  for (const label of ['Network Activity &amp; Validators', 'Liquidity &amp; TVL Context']) assert.ok(html.includes(label));
  assert.ok(!html.includes('id="methodology"'));
});

test('no disconnected SQL generator remains in the app', () => {
  for (const obsoleteId of ['sqlBuilderForm', 'downloadSqlButton', 'generatedSqlCode']) assert.ok(!html.includes(obsoleteId));
  assert.ok(!app.includes('generateSql'));
  assert.ok(!workspace.includes('buildActivitySql'));
});

test('Thesis Challenge source recipe is visible in the feature and included in its evidence export', () => {
  assert.ok(THESIS_TEST_RECIPE.query.includes('api.coingecko.com'));
  assert.ok(THESIS_TEST_RECIPE.query.includes('api.llama.fi'));
  assert.ok(THESIS_TEST_RECIPE.method.length >= 3);
  assert.ok(THESIS_TEST_RECIPE.limitations.length >= 3);
  assert.ok(html.includes('id="thesisSourceQuery"'));
  assert.ok(html.includes('id="thesisSourceStatus"'));
  assert.ok(app.includes('createThesisTestEvidence'));
});
