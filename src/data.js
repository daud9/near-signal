import { summarizeBlock, summarizeBlockTransactions, summarizeValidators } from './analytics.js';

const RPC_URL = 'https://free.rpc.fastnear.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const LLAMA_PRICE_URL = 'https://coins.llama.fi/prices/current/coingecko:near';
const LLAMA_TVL_URL = 'https://api.llama.fi/v2/historicalChainTvl/near';
function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function parseProviderTimestamp(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const number = finiteNumber(value);
  if (number === null || number <= 0) return null;
  const millis = number > 1e15 ? number / 1e6 : number > 1e12 ? number : number * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const DATA_SOURCES = [
  {
    id: 'pikespeak-active-accounts', name: 'Daily account history candidate — Pikespeak, not connected',
    url: 'https://api.pikespeak.ai/network/active-accounts', docUrl: 'https://api.pikespeak.ai/docs',
    kind: 'Not queried — provider API key and plan required', fields: 'Would provide a provider-reported daily active-account count with UTC date',
    cadence: 'No requests are made by this no-key MVP.',
    caveat: 'No API key or account-history source is configured. A provider-reported address count would not establish verified people, returning-user retention or organic adoption.', connected: false,
  },
  {
    id: 'near-rpc-finalized', name: 'FastNear public mainnet RPC (free tier) — finalized block',
    url: RPC_URL, docUrl: 'https://docs.near.org/api/rpc/block-chunk',
    kind: 'Read-only JSON-RPC', fields: 'finalized block height/hash/time, per-shard gas used and gas limit',
    cadence: 'Polled once per minute while the page is open.',
    caveat: 'One provider view, not a network-wide health guarantee. NEAR lists this public endpoint in FastNear’s free tier but publishes no numeric limit; polling is intentionally conservative.', connected: true, staleAfterSeconds: 120,
  },
  {
    id: 'near-rpc-block-transactions', name: 'FastNear public mainnet RPC (free tier) — sampled block transactions',
    url: RPC_URL, docUrl: 'https://docs.near.org/api/rpc/block-chunk',
    kind: 'Read-only JSON-RPC', fields: 'transaction-array lengths for every shard chunk referenced by one finalized block; matched chunk hashes and per-shard counts',
    cadence: 'Sampled on initial load and no more than once every five minutes; one chunk read per shard in that block.',
    caveat: 'A count for one finalized block is not a daily series, unique-user count or adoption trend. The finalized block and minimal chunk verification fields plus transaction hashes are retained locally for replay; full transaction bodies and receipt payloads are discarded. FastNear’s free-tier request limit is not published; the app samples conservatively.', connected: true, staleAfterSeconds: 600,
  },
  {
    id: 'near-rpc-status', name: 'FastNear public mainnet RPC (free tier) — node status',
    url: RPC_URL, docUrl: 'https://docs.near.org/api/rpc/network',
    kind: 'Read-only JSON-RPC', fields: 'chain ID, sync state, latest observed block/time',
    cadence: 'Fetched on load and then every five minutes.',
    caveat: 'The queried node’s status is not an uptime record or a consensus-wide diagnosis.', connected: true, staleAfterSeconds: 360,
  },
  {
    id: 'near-rpc-validators', name: 'FastNear public mainnet RPC (free tier) — current validator set',
    url: RPC_URL, docUrl: 'https://docs.near.org/api/rpc/network',
    kind: 'Read-only JSON-RPC', fields: 'current and next validator sets, stake, epoch production counters',
    cadence: 'Fetched on load and then every five minutes; cache the snapshot between requests.',
    caveat: 'Concentration is within the RPC-reported active validator set, not all stakers, apps, or users. No historical epochs are fetched.', connected: true, staleAfterSeconds: 600,
  },
  {
    id: 'coingecko-market', name: 'CoinGecko keyless market snapshot',
    url: `${COINGECKO_BASE}/simple/price?ids=near&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
    docUrl: 'https://docs.coingecko.com/docs/keyless-public-api',
    kind: 'Aggregated market data', fields: 'USD spot, market capitalization, gross 24-hour exchange volume, 24-hour change and provider time',
    cadence: 'Fetched on page load or user refresh only; no background polling. User refresh is throttled.',
    caveat: 'Keyless API is intended for testing/open-source/educational use and is not recommended for production or scheduled polling. Shared dynamic limit is about five calls/minute; visible attribution is required. Not on-chain volume or net flow.', connected: true, staleAfterSeconds: 1800,
  },
  {
    id: 'coingecko-history', name: 'CoinGecko 32-day market history',
    url: `${COINGECKO_BASE}/coins/near/market_chart?vs_currency=usd&days=32&interval=daily`,
    docUrl: 'https://docs.coingecko.com/demo/reference/coins-id-market-chart',
    kind: 'Aggregated daily market history', fields: 'daily price, market capitalization and gross market volume observations',
    cadence: 'Fetched on page load or user refresh only; no background polling.',
    caveat: 'Keyless market history is a short contextual sample and can be shared-limit or CORS constrained. Latest partial UTC date is excluded from matched history.', connected: true,
  },
  {
    id: 'defillama-price', name: 'DefiLlama NEAR spot price',
    url: LLAMA_PRICE_URL, docUrl: 'https://api-docs.defillama.com/llms.txt',
    kind: 'Aggregated market data', fields: 'USD price, provider timestamp and confidence',
    cadence: 'Polled every two minutes; provider response is cached and not tick-level.',
    caveat: 'Independent price cross-check only. The value is not an on-chain price oracle or a guarantee of executable market price.', connected: true, staleAfterSeconds: 900,
  },
  {
    id: 'defillama-tvl', name: 'DefiLlama NEAR historical DeFi TVL',
    url: LLAMA_TVL_URL, docUrl: 'https://docs.llama.fi/analysts/data-definitions',
    kind: 'Indexed daily USD snapshots', fields: 'date and NEAR DeFi total value locked (TVL)',
    cadence: 'Fetched on load and then every 30 minutes; latest point is retained with its own UTC date.',
    caveat: 'TVL is an asset stock, affected by market prices and provider coverage. It is not bridge volume, net inflow or capital retention.', connected: true,
  },
  {
    id: 'nearblocks-history', name: 'NearBlocks daily account/transaction history',
    url: 'https://api.nearblocks.io/api-docs', docUrl: 'https://nearblocks.io/terms',
    kind: 'Not connected — provider permission required', fields: 'Would support indexed activity history and account-level measures',
    cadence: 'No requests are made by this app.',
    caveat: 'The free plan is personal-use; Terms require prior written consent for third-party apps and prohibit automated data collection. Legacy v1/v2 shutdown is scheduled for 22 Nov 2026. Obtain written permission before reconnecting.', connected: false,
  },
  {
    id: 'fastnear-history', name: 'FastNEAR indexed history',
    url: 'https://docs.fastnear.com/tx', docUrl: 'https://docs.fastnear.com/auth',
    kind: 'Not connected — API key required', fields: 'Indexed transaction, receipt and account-history reads',
    cadence: 'No requests are made by this app.',
    caveat: 'Provider docs require an API key. Keep server keys server-side; browser keys must be domain-restricted. Not a credential-free replacement for global daily account statistics.', connected: false,
  },
  {
    id: 'bigquery-history', name: 'NEAR public BigQuery dataset',
    url: 'https://console.cloud.google.com/bigquery?p=bigquery-public-data&d=crypto_near_mainnet_us&page=dataset', docUrl: 'https://docs.near.org/data-infrastructure/big-query',
    kind: 'Not connected — Google Cloud project/auth required', fields: '16 objects inspected in the live console; query tables transactions, receipt_actions and receipt_origin_transaction are partitioned on block_date DATE; signer/hash/receiver fields are STRING',
    cadence: 'No queries are made by this static app.',
    caveat: 'Live inventory and three query-table schemas inspected on 14 Nov 2026; application data integration remains disconnected. No query or dry-run was submitted. Review estimated bytes and obtain spending approval before execution.', connected: false,
  },
  {
    id: 'intents-history', name: 'NEAR Intents Explorer',
    url: 'https://explorer.near-intents.org/api/v0/transactions', docUrl: 'https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction',
    kind: 'Not connected — partner JWT required', fields: 'Historical 1Click swap records and statuses only',
    cadence: 'No requests are made by this app.',
    caveat: 'Explorer requests require a Partner Dashboard JWT in the Bearer header and are limited to one request every five seconds per partner. Scope is historical 1Click Swap only, not all NEAR Intents or canonical ecosystem-wide net flow. A JWT must not be embedded in browser code.', connected: false,
  },
];

async function getJson(url, { method = 'GET', body, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json();
        if (typeof errorBody?.error === 'string') detail = errorBody.error;
        else if (typeof errorBody?.message === 'string') detail = errorBody.message;
      } catch { /* Some providers return a non-JSON error page. */ }
      throw new Error(detail);
    }
    const data = await response.json();
    if (data?.error) throw new Error(data.error.message || 'Source returned an RPC error');
    if (Array.isArray(data?.errors) && data.errors.length) throw new Error(data.errors[0]?.message || 'Source returned an error');
    return { data, latencyMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

async function sourceCall(sourceId, call, transform = (value) => value) {
  try {
    const response = await call();
    const checkedAt = new Date().toISOString();
    return {
      value: transform(response.data, checkedAt),
      status: { sourceId, ok: true, checkedAt, providerAt: null, latencyMs: response.latencyMs, detail: '' },
    };
  } catch (error) {
    const checkedAt = new Date().toISOString();
    const message = error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'Request failed';
    return { status: { sourceId, ok: false, checkedAt, providerAt: null, latencyMs: null, detail: message } };
  }
}

const rpcRequest = (method, params) => getJson(RPC_URL, {
  method: 'POST',
  body: { jsonrpc: '2.0', id: `near-signal-${method}`, method, params },
});

export async function fetchFinalizedBlock() {
  const result = await sourceCall('near-rpc-finalized', () => rpcRequest('block', { finality: 'final' }), (data, checkedAt) => {
    const value = summarizeBlock(data.result, Date.now());
    if (!value) throw new Error('RPC did not return a valid finalized block');
    return { ...value, fetchedAt: checkedAt, finality: 'final', raw: data.result };
  });
  if (result.value) result.status.providerAt = result.value.timestamp;
  return result;
}

export async function fetchBlockTransactionCount(block) {
  const result = await sourceCall('near-rpc-block-transactions', async () => {
    if (!Number.isSafeInteger(block?.height) || !Array.isArray(block?.chunkRefs) || block.chunkRefs.length === 0) throw new Error('No complete finalized-block shard references are available');
    if (block.chunkRefs.length > 128) throw new Error('RPC returned an unexpected shard count; chunk requests were withheld');
    const started = performance.now();
    const responses = await Promise.all(block.chunkRefs.map((ref) => rpcRequest('chunk', { block_id: block.height, shard_id: ref.shardId })));
    return { data: responses.map((response) => response.data.result), latencyMs: Math.round(performance.now() - started) };
  }, (chunkResults, checkedAt) => {
    const value = summarizeBlockTransactions(block, chunkResults);
    if (!value) throw new Error('A shard chunk was missing, mismatched or malformed; the full-block transaction total is withheld');
    const rawChunks = chunkResults.map((chunk) => ({
      header: { shard_id: chunk.header.shard_id, chunk_hash: chunk.header.chunk_hash, height_included: chunk.header.height_included },
      transactions: chunk.transactions.map((transaction) => ({ hash: transaction.hash })),
    }));
    return { ...value, fetchedAt: checkedAt, rawChunks };
  });
  if (result.value) result.status.providerAt = block.timestamp;
  return result;
}

export async function fetchRpcStatus() {
  const result = await sourceCall('near-rpc-status', () => rpcRequest('status', []), (data) => {
    const value = data.result;
    if (value?.chain_id !== 'mainnet' || !value?.sync_info) throw new Error('RPC did not identify a usable NEAR mainnet status');
    return value;
  });
  result.status.providerAt = parseProviderTimestamp(result.value?.sync_info?.latest_block_time);
  return result;
}

export async function fetchValidatorSet() {
  const result = await sourceCall('near-rpc-validators', () => rpcRequest('validators', [null]), (data, checkedAt) => {
    const value = summarizeValidators(data.result);
    if (!value) throw new Error('RPC did not return a current validator set');
    return { ...value, asOf: checkedAt };
  });
  if (result.value) result.status.providerAt = result.value.asOf;
  return result;
}

export async function fetchDefiLlamaPrice() {
  const result = await sourceCall('defillama-price', () => getJson(LLAMA_PRICE_URL), (data) => {
    const item = data?.coins?.['coingecko:near'];
    const price = finiteNumber(item?.price), timestamp = finiteNumber(item?.timestamp);
    if (price === null || price <= 0 || timestamp === null || timestamp <= 0) throw new Error('DefiLlama returned no usable NEAR price');
    return {
      priceUsd: price,
      symbol: item.symbol || 'NEAR',
      timestamp: new Date(timestamp * 1000).toISOString(),
      confidence: finiteNumber(item.confidence),
    };
  });
  if (result.value) result.status.providerAt = result.value.timestamp;
  return result;
}

export async function fetchCoinGeckoMarket() {
  const url = `${COINGECKO_BASE}/simple/price?ids=near&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`;
  const result = await sourceCall('coingecko-market', () => getJson(url), (data, checkedAt) => {
    const item = data?.near;
    const priceUsd = finiteNumber(item?.usd), marketCapUsd = finiteNumber(item?.usd_market_cap);
    const grossVolume24hUsd = finiteNumber(item?.usd_24h_vol), priceChange24hPct = finiteNumber(item?.usd_24h_change);
    const updatedAt = finiteNumber(item?.last_updated_at);
    if (!item || priceUsd === null || priceUsd <= 0 || updatedAt === null || updatedAt <= 0) throw new Error('CoinGecko returned no timestamped NEAR price');
    return {
      priceUsd,
      marketCapUsd: marketCapUsd !== null && marketCapUsd >= 0 ? marketCapUsd : null,
      grossVolume24hUsd: grossVolume24hUsd !== null && grossVolume24hUsd >= 0 ? grossVolume24hUsd : null,
      priceChange24hPct,
      timestamp: updatedAt !== null && updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : null,
      fetchedAt: checkedAt,
    };
  });
  if (result.value) result.status.providerAt = result.value.timestamp;
  return result;
}

export async function fetchCoinGeckoHistory() {
  const url = `${COINGECKO_BASE}/coins/near/market_chart?vs_currency=usd&days=32&interval=daily`;
  const result = await sourceCall('coingecko-history', () => getJson(url), (data, fetchedAt) => {
    if (!Array.isArray(data?.prices) || data.prices.length < 2) throw new Error('CoinGecko returned too few daily market points');
    return { ...data, fetchedAt };
  });
  const timestamps = result.value?.prices?.map((point) => Number(point?.[0])).filter(Number.isFinite) ?? [];
  if (timestamps.length) result.status.providerAt = new Date(Math.max(...timestamps)).toISOString();
  return result;
}

export async function fetchTvlHistory() {
  const result = await sourceCall('defillama-tvl', () => getJson(LLAMA_TVL_URL), (data, fetchedAt) => {
    if (!Array.isArray(data) || data.length < 2) throw new Error('DefiLlama returned too few TVL points');
    return { rows: data, fetchedAt };
  });
  const timestamps = result.value?.rows?.map((row) => Number(row?.date)).filter(Number.isFinite) ?? [];
  if (timestamps.length) result.status.providerAt = new Date(Math.max(...timestamps) * 1000).toISOString();
  return result;
}

export function statusFromMissingSource(source) {
  return { sourceId: source.id, ok: null, checkedAt: null, providerAt: null, latencyMs: null, detail: source.caveat, disconnected: true };
}

// On-demand public account state only. No wallet, signing, account history or JWT.
export async function fetchAccountSnapshot(accountId) {
  if (typeof accountId !== 'string' || accountId.length < 2 || accountId.length > 64 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(accountId)) {
    return { status: { ok: false, detail: 'Enter a valid lowercase NEAR account ID.' } };
  }
  return sourceCall('near-rpc-account-inspector', () => rpcRequest('query', { request_type: 'view_account', finality: 'final', account_id: accountId }), (data, checkedAt) => {
    const raw = data?.result;
    if (!raw || !/^\d+$/.test(raw.amount) || !/^\d+$/.test(raw.locked) || !Number.isSafeInteger(raw.storage_usage) || !Number.isSafeInteger(raw.block_height) || typeof raw.code_hash !== 'string') throw new Error('RPC did not return a complete account snapshot. Verify that the account exists.');
    const balanceNear = Number(BigInt(raw.amount)) / 1e24, lockedNear = Number(BigInt(raw.locked)) / 1e24;
    if (!Number.isFinite(balanceNear) || !Number.isFinite(lockedNear)) throw new Error('RPC account balance is outside the supported numeric range.');
    return { endpoint: RPC_URL, accountId, balanceNear, lockedNear, storageBytes: raw.storage_usage, hasContract: raw.code_hash !== '11111111111111111111111111111111', codeHash: raw.code_hash, blockHeight: raw.block_height, blockHash: raw.block_hash, fetchedAt: checkedAt, raw, request: { jsonrpc: '2.0', id: 'near-signal-query', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } } };
  });
}
