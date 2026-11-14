import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BIGQUERY_ACTIVITY_QUERY, BIGQUERY_DATASET, BIGQUERY_INSPECTED_FIELDS, BIGQUERY_INSPECTED_TABLES } from '../src/query-registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'sql/near-signal.sql');

export async function exportQueries() {
  const contents = [
    '-- NEAR SIGNAL sample: daily transactions, signer accounts, and contract function-call usage.',
    '-- Source: https://docs.near.org/data-infrastructure/big-query',
    `-- Dataset: ${BIGQUERY_DATASET}`,
    `-- Live-inspected tables/views: ${BIGQUERY_INSPECTED_TABLES.join(', ')}`,
    `-- Live-inspected query fields: ${BIGQUERY_INSPECTED_FIELDS.join(', ')}`,
    '-- Schemas inspected 2026-11-14; SQL not executed or dry-run. Review estimated bytes and obtain query budget approval.',
    '-- Set @start_date DATE, @end_date DATE (exclusive), and @contract_account_id STRING. Accounts are signer proxies.',
    '',
    BIGQUERY_ACTIVITY_QUERY,
    '',
  ].join('\n');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, contents, 'utf8');
  return { output, contents };
}

const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  exportQueries().then(({ output }) => console.log(`Wrote ${output}`)).catch((error) => {
    console.error(`SQL export failed: ${error?.message || 'unexpected error'}`);
    process.exitCode = 1;
  });
}
