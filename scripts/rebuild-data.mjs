import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareWindows, normalizeDailyRows, pearsonCorrelation, signerConcentration } from '../src/analytics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = process.env.NEARBLOCKS_API_KEY;
const endpoints = {
  transactions: 'https://api.nearblocks.io/v3/txn-stats?limit=50',
  accounts: 'https://api.nearblocks.io/v3/address-stats?limit=50',
  recentTransactions: 'https://api.nearblocks.io/v3/txns?limit=100',
};

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const body = await response.json();
    if (body?.errors?.length) throw new Error(body.errors[0]?.message || 'Source returned an error');
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

const fetchedAt = new Date().toISOString();
const results = await Promise.allSettled(Object.entries(endpoints).map(async ([id, url]) => [id, url, await fetchJson(url)]));
const failures = results.filter((item) => item.status === 'rejected');
if (failures.length) {
  for (const failure of failures) console.error(`Source fetch failed: ${failure.reason?.message || failure.reason}`);
  process.exitCode = 1;
  console.error('No evidence snapshot was written because one or more required feeds failed.');
} else {
  const feeds = Object.fromEntries(results.map((item) => item.value).map(([id, url, response]) => [id, { url, data: Array.isArray(response?.data) ? response.data : [] }]));
  const daily = normalizeDailyRows(feeds.transactions.data, feeds.accounts.data);
  const comparison = compareWindows(daily, 14);
  const correlation = pearsonCorrelation([...comparison.prior, ...comparison.current], 'txns', 'activeAccounts');
  const snapshot = {
    product: 'NEAR SIGNAL',
    generatedAt: fetchedAt,
    mode: 'Live sourced data; no synthetic fallback',
    sourceDefinitions: Object.entries(feeds).map(([id, source]) => ({ id, url: source.url, returnedRows: source.data.length })),
    rawFeeds: Object.fromEntries(Object.entries(feeds).map(([id, source]) => [id, source.data])),
    matchedDailyRows: daily.length,
    latestMatchedDateUtc: daily.at(-1)?.date ?? null,
    matchedWindowDays: 14,
    comparison: {
      ready: comparison.ready,
      currentStartUtc: comparison.startDate,
      currentEndUtc: comparison.endDate,
      priorStartUtc: comparison.priorStartDate,
      priorEndUtc: comparison.priorEndDate,
      currentDailyMeans: comparison.currentMeans,
      priorDailyMeans: comparison.priorMeans,
      percentChange: comparison.changes,
      transactionsPerActiveAccount: {
        current: comparison.txnsPerActiveAccountCurrent,
        prior: comparison.txnsPerActiveAccountPrior,
        changePercent: comparison.txnsPerActiveAccountChange,
      },
      dailyTransactionsAndActiveAccountsPearson: correlation,
    },
    latestTransactionSignerSample: signerConcentration(feeds.recentTransactions.data),
    dailyObservations: daily,
    caveats: [
      'NearBlocks is an indexer; validate coverage and freshness against its documentation.',
      'Active accounts are addresses, not verified people or a retention cohort.',
      'Fees are not protocol revenue. Indexed transaction volume is not net capital flow.',
      'Correlation is descriptive and does not establish causality or prediction.',
      'The recent signer sample is not extrapolated to ecosystem-wide concentration.',
    ],
  };
  const output = resolve(root, 'data/latest-evidence.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${output}`);
  console.log(`Fetched ${daily.length} matched UTC days; latest matched date ${snapshot.latestMatchedDateUtc || 'unavailable'}; 14-day comparison ${comparison.ready ? 'ready' : 'insufficient history'}.`);
}
