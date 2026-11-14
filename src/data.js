import { summarizeBlock, summarizeNeardataBlockTransactions, summarizeValidators } from './analytics.js';

const RPC_URL = 'https://free.rpc.fastnear.com';
const NEARDATA_BASE_URL = 'https://mainnet.neardata.xyz';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const LLAMA_PRICE_URL = 'https://coins.llama.fi/prices/current/coingecko:near';
const LLAMA_TVL_URL = 'https://api.llama.fi/v2/historicalChainTvl/near';
const LLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const LLAMA_PROTOCOL_BASE = 'https://api.llama.fi/protocol';
const LLAMA_STABLECOINS_URL = 'https://stablecoins.llama.fi/stablecoins?includePrices=true';
function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function hasTwoValidPairs(points) {
  return Array.isArray(points) && points.filter((point) => Array.isArray(point) && point.length >= 2
    && finiteNumber(point[0]) > 0 && finiteNumber(point[1]) !== null).length >= 2;
}
function hasTwoValidTvlRows(rows) {
  return Array.isArray(rows) && rows.filter((row) => finiteNumber(row?.date) > 0
    && finiteNumber(row?.tvl) !== null && finiteNumber(row.tvl) >= 0).length >= 2;
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
    id: 'near-rpc-finalized', name: 'FastNear public mainnet RPC (free tier) — finalized block',
    url: RPC_URL, docUrl: 'https://docs.near.org/api/rpc/block-chunk',
    kind: 'Read-only JSON-RPC', fields: 'finalized block height/hash/time, per-shard gas used and gas limit',
    cadence: 'Polled once per minute while the page is open.',
    caveat: 'One provider view, not a network-wide health guarantee. NEAR lists this public endpoint in FastNear’s free tier but publishes no numeric limit; polling is intentionally conservative.', connected: true, staleAfterSeconds: 120,
  },
  {
    id: 'fastnear-neardata-block-transactions', name: 'FastNEAR Neardata — sampled finalized-block transactions',
    url: `${NEARDATA_BASE_URL}/v0/last_block/final`, docUrl: 'https://docs.fastnear.com/neardata',
    kind: 'Read-only block/shard bundle; no API key on the tested endpoint', fields: 'transaction-array lengths for each shard at the exact finalized RPC block height; matched block hash, chunk hashes and inclusion heights',
    cadence: 'One exact-height block request at most every five minutes while the page is open.',
    caveat: 'A count for one finalized block is not a daily series, unique-user count or adoption trend. Every chunk included at this block must match; a shard reference whose inclusion height is earlier contributes zero transactions for this block and does not need a new chunk payload. Only minimal chunk fields and transaction hashes are retained locally for replay; full transaction bodies and receipt payloads are discarded. No numeric request quota or gapless archive guarantee is published.', connected: true, staleAfterSeconds: 600,
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
    caveat: 'Keyless market history is a short contextual sample and can be shared-limit or CORS constrained. Latest partial UTC date is excluded from matched history.', connected: true, staleAfterSeconds: 172800,
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
    caveat: 'TVL is an asset stock, affected by market prices and provider coverage. It is not bridge volume, net inflow or capital retention.', connected: true, staleAfterSeconds: 172800,
  },
  {
    id: 'defillama-near-protocol-tvls', name: 'DefiLlama — selected NEAR protocol TVL histories',
    url: LLAMA_PROTOCOLS_URL, docUrl: 'https://api-docs.defillama.com/',
    kind: 'Public protocol index plus dated chain-specific TVL histories', fields: 'Top eight non-CEX protocols with a reported NEAR chain balance; dated `chainTvls.Near.tvl` USD observations',
    cadence: 'Fetched on load and then every 30 minutes; each risk uses dated observations, not global protocol-wide percentage fields.',
    caveat: 'DefiLlama coverage and USD balances can change with token prices; this is not a withdrawal ledger, solvency test or complete list of NEAR apps.', connected: true, staleAfterSeconds: 172800,
  },
  {
    id: 'defillama-near-stablecoins', name: 'DefiLlama — stablecoin prices and NEAR circulation',
    url: LLAMA_STABLECOINS_URL, docUrl: 'https://api-docs.defillama.com/',
    kind: 'Public aggregate stablecoin snapshot', fields: 'USD peg classification, current USD price and reported NEAR-chain circulating value',
    cadence: 'Fetched on load and then every 30 minutes; browser check time is shown because the response does not expose a price timestamp.',
    caveat: 'A market quote does not prove redemption or reserves. Chain circulation is aggregator coverage and not a protocol-liability measure.', connected: true, staleAfterSeconds: 7200,
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

export async function fetchNeardataBlockTransactionCount(block) {
  const result = await sourceCall('fastnear-neardata-block-transactions', () => {
    if (!Number.isSafeInteger(block?.height) || block.height < 0 || typeof block?.hash !== 'string' || !Array.isArray(block?.chunkRefs) || block.chunkRefs.length === 0 || block.chunkRefs.length > 128) {
      throw new Error('No complete finalized-block shard references are available');
    }
    return getJson(`${NEARDATA_BASE_URL}/v0/block/${block.height}`);
  }, (payload, checkedAt) => {
    const value = summarizeNeardataBlockTransactions(block, payload);
    if (!value) throw new Error('Neardata returned a missing, mismatched or incomplete shard chunk; the full-block transaction count is withheld');
    return { ...value, fetchedAt: checkedAt };
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
    if (!hasTwoValidPairs(data?.prices) || !hasTwoValidPairs(data?.market_caps) || !hasTwoValidPairs(data?.total_volumes)) {
      throw new Error('CoinGecko returned too few valid dated price, market-cap or volume points');
    }
    return { ...data, fetchedAt };
  });
  const timestamps = result.value?.prices?.map((point) => Number(point?.[0])).filter(Number.isFinite) ?? [];
  if (timestamps.length) result.status.providerAt = new Date(Math.max(...timestamps)).toISOString();
  return result;
}

export async function fetchTvlHistory() {
  const result = await sourceCall('defillama-tvl', () => getJson(LLAMA_TVL_URL), (data, fetchedAt) => {
    if (!hasTwoValidTvlRows(data)) throw new Error('DefiLlama returned too few valid dated TVL points');
    return { rows: data, fetchedAt };
  });
  const timestamps = result.value?.rows?.map((row) => Number(row?.date)).filter(Number.isFinite) ?? [];
  if (timestamps.length) result.status.providerAt = new Date(Math.max(...timestamps) * 1000).toISOString();
  return result;
}

export async function fetchNearProtocolTvls() {
  const sourceId = 'defillama-near-protocol-tvls';
  const checkedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const index = await getJson(LLAMA_PROTOCOLS_URL);
    if (!Array.isArray(index.data)) throw new Error('DefiLlama protocol index was not an array');
    const candidates = index.data
      .filter((item) => typeof item?.slug === 'string' && item.slug && item.category !== 'CEX'
        && Array.isArray(item.chains) && item.chains.some((chain) => String(chain).toLowerCase() === 'near')
        && finiteNumber(item.chainTvls?.Near) >= 100_000)
      .sort((a, b) => finiteNumber(b.chainTvls?.Near) - finiteNumber(a.chainTvls?.Near))
      .slice(0, 8);
    if (!candidates.length) throw new Error('No material non-CEX NEAR protocol rows were returned');

    const settled = await Promise.allSettled(candidates.map(async (item) => {
      const response = await getJson(`${LLAMA_PROTOCOL_BASE}/${encodeURIComponent(item.slug)}`);
      const raw = response.data?.chainTvls?.Near?.tvl;
      if (!Array.isArray(raw)) throw new Error(`${item.slug} has no dated NEAR TVL history`);
      const points = raw.map((point) => ({
        date: finiteNumber(point?.date),
        totalLiquidityUsd: finiteNumber(point?.totalLiquidityUSD),
      })).filter((point) => point.date !== null && point.date > 0 && point.totalLiquidityUsd !== null && point.totalLiquidityUsd >= 0)
        .sort((a, b) => a.date - b.date);
      if (points.length < 2) throw new Error(`${item.slug} returned fewer than two valid dated NEAR TVL points`);
      return {
        slug: item.slug,
        name: typeof response.data.name === 'string' ? response.data.name : String(item.name || item.slug),
        category: String(item.category || 'Unclassified'),
        nearTvlUsd: points.at(-1).totalLiquidityUsd,
        points: points.slice(-40),
      };
    }));
    const protocols = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    const failedCount = settled.length - protocols.length;
    if (!protocols.length) throw new Error('No selected protocol returned valid dated NEAR TVL history');
    const latest = Math.max(...protocols.flatMap((item) => item.points.map((point) => point.date)));
    const latencyMs = Math.round(performance.now() - started);
    return {
      value: { protocols, fetchedAt: checkedAt, requestedCount: candidates.length, returnedCount: protocols.length },
      status: {
        sourceId, ok: true, partial: failedCount > 0, checkedAt, providerAt: new Date(latest * 1000).toISOString(), latencyMs,
        detail: failedCount ? `${protocols.length}/${candidates.length} selected histories returned; ${failedCount} history request(s) failed.` : '',
      },
    };
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'Request failed';
    return { status: { sourceId, ok: false, checkedAt: new Date().toISOString(), providerAt: null, latencyMs: null, detail: message } };
  }
}

export async function fetchNearStablecoins() {
  return sourceCall('defillama-near-stablecoins', () => getJson(LLAMA_STABLECOINS_URL), (data, fetchedAt) => {
    if (!Array.isArray(data?.peggedAssets)) throw new Error('DefiLlama stablecoin response has no peggedAssets array');
    const assets = data.peggedAssets.filter((asset) => asset?.chainCirculating?.Near)
      .map((asset) => ({
        id: String(asset.id ?? ''), name: String(asset.name ?? asset.symbol ?? 'Unknown asset'),
        symbol: String(asset.symbol ?? ''), geckoId: typeof asset.gecko_id === 'string' ? asset.gecko_id : null,
        pegType: String(asset.pegType ?? ''), pegMechanism: String(asset.pegMechanism ?? ''),
        priceSource: String(asset.priceSource ?? ''), priceUsd: finiteNumber(asset.price),
        currentNearCirculationUsd: finiteNumber(asset.chainCirculating.Near.current?.peggedUSD),
        priorDayNearCirculationUsd: finiteNumber(asset.chainCirculating.Near.circulatingPrevDay?.peggedUSD),
      })).filter((asset) => asset.id && asset.currentNearCirculationUsd !== null && asset.currentNearCirculationUsd >= 0);
    return { assets, fetchedAt };
  });
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
