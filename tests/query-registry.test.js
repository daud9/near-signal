import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BIGQUERY_ACTIVITY_QUERY, BIGQUERY_DATASET, BIGQUERY_INSPECTED_FIELDS, BIGQUERY_INSPECTED_TABLES, CHART_QUERY_RECIPES, THESIS_TEST_RECIPE } from '../src/query-registry.js';

const sqlFile = readFileSync(new URL('../sql/near-signal.sql', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('BigQuery activity template filters all three scanned relations on block_date', () => {
  assert.equal(BIGQUERY_DATASET, 'bigquery-public-data.crypto_near_mainnet_us');
  const whereClauses = BIGQUERY_ACTIVITY_QUERY.split(/\bWHERE\b/i).slice(1);
  assert.equal(whereClauses.length, 3);
  assert.ok(whereClauses.every((clause) => /\b(?:ra\.)?block_date >= @start_date AND (?:ra\.)?block_date < @end_date/.test(clause.split(/\bGROUP BY\b/i)[0])));
  assert.equal((BIGQUERY_ACTIVITY_QUERY.match(/bigquery-public-data\.crypto_near_mainnet_us\./g) ?? []).length, 3);
  for (const field of ['transaction_hash', 'signer_account_id', 'action_kind', 'receipt_receiver_account_id', 'receipt_id']) {
    assert.ok(BIGQUERY_ACTIVITY_QUERY.includes(field), `Expected inspected query field ${field}`);
  }
  assert.ok(BIGQUERY_ACTIVITY_QUERY.includes('@contract_account_id'));
  assert.ok(BIGQUERY_ACTIVITY_QUERY.includes('receipts_without_in_window_origin'));
  assert.ok(!BIGQUERY_ACTIVITY_QUERY.includes('CURRENT_DATE'), 'Explicit dates make exported runs reproducible');
});

test('live dataset inventory has 16 objects and resolves the stale receipt-origin names', () => {
  assert.equal(BIGQUERY_INSPECTED_TABLES.length, 16);
  for (const table of ['blocks', 'transactions', 'receipt_actions', 'receipt_origin_transaction', 'accounts (view)', 'ft_balances_daily']) {
    assert.ok(BIGQUERY_INSPECTED_TABLES.includes(table), `Missing inspected table ${table}`);
  }
  assert.ok(!BIGQUERY_INSPECTED_TABLES.includes('receipt_origin'));
  assert.ok(!BIGQUERY_INSPECTED_TABLES.includes('receipts (view)'));
  assert.ok(BIGQUERY_INSPECTED_FIELDS.includes('block_date (DATE)'));
  assert.ok(sqlFile.includes(BIGQUERY_ACTIVITY_QUERY), 'Checked-in SQL should match the shared dashboard query template');
});

test('each dashboard chart exposes its query, rebuild rule and plain-language meaning', () => {
  for (const chartId of ['overviewChart', 'gasChart', 'blockTxChart', 'capitalChart']) {
    const recipe = CHART_QUERY_RECIPES[chartId];
    assert.ok(recipe?.source && recipe?.query && recipe?.plainLanguage, `Missing recipe for ${chartId}`);
    assert.ok(html.includes(`id="${chartId}"`));
    assert.ok(app.includes('chartQueryDisclosure(container.id)'));
  }
  for (const label of ['Network Activity &amp; Validators', 'Liquidity &amp; TVL Context']) assert.ok(html.includes(label));
  assert.ok(!html.includes('NEAR Intents Explorer API'));
  assert.ok(!html.includes('id="methodology"'));
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
