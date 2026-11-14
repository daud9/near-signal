import { normalizeDailyRows } from './analytics.js';

export const DATA_SOURCES = [
  {
    id: 'nearblocks-txn-stats',
    name: 'NearBlocks daily transaction statistics',
    url: 'https://api.nearblocks.io/v3/txn-stats?limit=50',
    docUrl: 'https://api.nearblocks.io/api-docs',
    kind: 'Indexer API',
    fields: 'date, txns, txn_fee, txn_volume, receipts',
    cadence: 'Public daily aggregate; source update lag is visible in the newest returned date.',
    caveat: 'Indexer-derived. Fees are not protocol revenue and indexed volume is not net flow. Official docs describe Bearer-key access, attribution and plan limits; a small unauthenticated test succeeded, but public-project use and terms need review.',
  },
  {
    id: 'nearblocks-address-stats',
    name: 'NearBlocks daily account statistics',
    url: 'https://api.nearblocks.io/v3/address-stats?limit=50',
    docUrl: 'https://api.nearblocks.io/api-docs',
    kind: 'Indexer API',
    fields: 'date, active_accounts, active_contracts, new_contracts, meta_accounts',
    cadence: 'Public daily aggregate; joined by UTC date to the transaction feed.',
    caveat: 'Accounts and contracts are address-level observations, not verified humans or retained users.',
  },
  {
    id: 'nearblocks-recent-transactions',
    name: 'NearBlocks latest transaction sample',
    url: 'https://api.nearblocks.io/v3/txns?limit=100',
    docUrl: 'https://api.nearblocks.io/api-docs',
    kind: 'Indexer API',
    fields: 'Recent indexed transaction signer identifiers',
    cadence: 'Fetched once on page load or manual refresh.',
    caveat: 'A small recent sample only; never extrapolated to network-wide concentration.',
  },
  {
    id: 'near-rpc-status',
    name: 'NEAR public mainnet RPC status',
    url: 'https://rpc.mainnet.near.org',
    docUrl: 'https://docs.near.org/api/rpc/providers',
    kind: 'JSON-RPC',
    fields: 'chain_id, sync_info.latest_block_height, sync_info.latest_block_time, sync_info.syncing',
    cadence: 'Single point-in-time request on page load or refresh.',
    caveat: 'One status response is not an uptime history, validator concentration metric, or security assessment.',
  },
];

async function getJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 18_000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body?.errors?.length) throw new Error(body.errors[0]?.message || 'Source reported an error');
    if (body?.error) throw new Error(body.error.message || 'RPC returned an error');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function statusRecord(sourceId, ok, detail = '') {
  return { sourceId, ok, detail, checkedAt: new Date().toISOString() };
}

export async function loadNearSignalData() {
  const loadedAt = new Date().toISOString();
  const txUrl = DATA_SOURCES[0].url;
  const accountsUrl = DATA_SOURCES[1].url;
  const sampleUrl = DATA_SOURCES[2].url;
  const rpcUrl = DATA_SOURCES[3].url;
  const rpcBody = { jsonrpc: '2.0', id: 'near-signal-status', method: 'status', params: [] };
  const results = await Promise.allSettled([
    getJson(txUrl),
    getJson(accountsUrl),
    getJson(sampleUrl),
    getJson(rpcUrl, { method: 'POST', body: rpcBody }),
  ]);

  const [txResult, accountResult, sampleResult, rpcResult] = results;
  const feedStatuses = [
    statusRecord('nearblocks-txn-stats', txResult.status === 'fulfilled', txResult.status === 'fulfilled' ? '' : txResult.reason?.message || 'Request failed'),
    statusRecord('nearblocks-address-stats', accountResult.status === 'fulfilled', accountResult.status === 'fulfilled' ? '' : accountResult.reason?.message || 'Request failed'),
    statusRecord('nearblocks-recent-transactions', sampleResult.status === 'fulfilled', sampleResult.status === 'fulfilled' ? '' : sampleResult.reason?.message || 'Request failed'),
    statusRecord('near-rpc-status', rpcResult.status === 'fulfilled' && rpcResult.value?.result?.chain_id === 'mainnet', rpcResult.status === 'fulfilled' ? (rpcResult.value?.result?.chain_id === 'mainnet' ? '' : 'RPC did not identify mainnet') : rpcResult.reason?.message || 'Request failed'),
  ];

  let daily = [];
  let dataError = '';
  if (txResult.status === 'fulfilled' && accountResult.status === 'fulfilled') {
    const txRows = Array.isArray(txResult.value?.data) ? txResult.value.data : [];
    const accountRows = Array.isArray(accountResult.value?.data) ? accountResult.value.data : [];
    daily = normalizeDailyRows(txRows, accountRows);
    if (daily.length < 2) dataError = 'Fewer than two complete UTC dates are available in both public indexer feeds.';
  } else {
    dataError = 'One or both required public daily feeds could not be loaded. No fallback values are used.';
  }

  const recentTransactions = sampleResult.status === 'fulfilled' && Array.isArray(sampleResult.value?.data)
    ? sampleResult.value.data
    : [];
  const rpcStatus = rpcResult.status === 'fulfilled' && rpcResult.value?.result?.chain_id === 'mainnet'
    ? rpcResult.value.result
    : null;

  return {
    loadedAt,
    daily,
    recentTransactions,
    rpcStatus,
    sourceStatuses: feedStatuses,
    dataError,
    rawFeedLengths: {
      transactionDays: txResult.status === 'fulfilled' && Array.isArray(txResult.value?.data) ? txResult.value.data.length : 0,
      accountDays: accountResult.status === 'fulfilled' && Array.isArray(accountResult.value?.data) ? accountResult.value.data.length : 0,
      transactionSample: recentTransactions.length,
    },
  };
}
