import { summarizeBlock, summarizeNeardataBlockTransactions, summarizeValidators, toUtcDate } from './analytics.js';

const RPC_URL = 'https://free.rpc.fastnear.com';
const NEARDATA_BASE_URL = 'https://mainnet.neardata.xyz';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const LLAMA_PRICE_URL = 'https://coins.llama.fi/prices/current/coingecko:near';
const LLAMA_TVL_URL = 'https://api.llama.fi/v2/historicalChainTvl/near';
const LLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const LLAMA_PROTOCOL_BASE = 'https://api.llama.fi/protocol';
const LLAMA_STABLECOINS_URL = 'https://stablecoins.llama.fi/stablecoins?includePrices=true';
const LLAMA_DEX_OVERVIEW_URL = 'https://api.llama.fi/overview/dexs/Near';
const LLAMA_FEES_OVERVIEW_URL = 'https://api.llama.fi/overview/fees/Near';
const GECKOTERMINAL_POOLS_URL = 'https://api.geckoterminal.com/api/v2/networks/near/pools?page=1';
const LLAMA_NEAR_STABLECOIN_HISTORY_URL = 'https://stablecoins.llama.fi/stablecoincharts/Near';
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
  {
    id: 'defillama-near-stablecoin-history', name: 'DefiLlama — dated NEAR stablecoin circulation',
    url: LLAMA_NEAR_STABLECOIN_HISTORY_URL, docUrl: 'https://api-docs.defillama.com/',
    kind: 'Public aggregate daily stablecoin history', fields: 'Dated totalCirculating.peggedUSD, totalCirculatingUSD.peggedUSD and totalMintedUSD.peggedUSD series for NEAR',
    cadence: 'Fetched on load and then every 30 minutes; only complete dated observations enter the seven-day comparison.',
    caveat: 'Provider coverage can change with migrations, classification or historical corrections. Aggregate circulation is not a withdrawal, redemption, reserve or solvency ledger.', connected: true, staleAfterSeconds: 172800,
  },
  {
    id: 'defillama-near-dex-volume', name: 'DefiLlama — NEAR DEX volume history',
    url: LLAMA_DEX_OVERVIEW_URL, docUrl: 'https://api-docs.defillama.com/',
    kind: 'Indexed daily USD activity history', fields: 'dated chain DEX volume and daily protocol breakdown when returned',
    cadence: 'Fetched on load and then every 30 minutes; current partial UTC date is excluded from daily windows.',
    caveat: 'DEX notional volume can include arbitrage and routing. It is activity, not pool depth, deposits, net inflow or investment.', connected: true, staleAfterSeconds: 172800,
  },
  {
    id: 'defillama-near-fees', name: 'DefiLlama — NEAR indexed chain-fee history',
    url: LLAMA_FEES_OVERVIEW_URL, docUrl: 'https://api-docs.defillama.com/',
    kind: 'Provider-indexed daily USD fee series', fields: 'dated chain fee observations from the DefiLlama fees dashboard',
    cadence: 'Fetched on load and then every 30 minutes; only consecutive dated observations are aggregated.',
    caveat: 'Provider coverage and methodology; not a reconciled transaction/receipt fee ledger, realized revenue, validator income or APY.', connected: true, staleAfterSeconds: 172800,
  },
  {
    id: 'geckoterminal-near-pools', name: 'GeckoTerminal — NEAR top-pool page 1 snapshot',
    url: GECKOTERMINAL_POOLS_URL, docUrl: 'https://api.geckoterminal.com/docs/index.html',
    kind: 'Public rolling pool-market snapshot', fields: 'up to 20 returned pool reserves, rolling volumes, transaction counts and price changes',
    cadence: 'Fetched on load and then every five minutes; provider cache is one minute.',
    caveat: 'Beta API with an approximate 10-call/minute public limit. Page 1 is bounded coverage, not all pools; pool reserves are not chain-wide TVL.', connected: true, staleAfterSeconds: 360,
  },
  {
    id: 'near-rpc-protocol-config', name: 'FastNEAR public mainnet RPC — block-specific protocol configuration',
    url: RPC_URL, docUrl: 'https://docs.near.org/api/rpc/protocol',
    kind: 'Read-only JSON-RPC', fields: 'protocol version and runtime burnt_gas_reward rule queried by observed block height',
    cadence: 'Fetched on load and on protocol-version change; otherwise rechecked every 30 minutes.',
    caveat: 'A fee rule is not a realized burn ledger. Block gas × gas price remains an execution-value proxy, not exact user-paid fees or revenue.', connected: true, staleAfterSeconds: 3600,
  },
];

async function getJson(url, { method = 'GET', body, timeoutMs = 20_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
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

export async function fetchProtocolConfig(block) {
  const result = await sourceCall('near-rpc-protocol-config', () => {
    if (!Number.isSafeInteger(block?.height) || block.height < 0 || block.protocolVersion === null || block.protocolVersion === undefined || !Number.isSafeInteger(Number(block.protocolVersion))) {
      throw new Error('A finalized block with a reported protocol version is required');
    }
    return rpcRequest('EXPERIMENTAL_protocol_config', { block_id: block.height });
  }, (data, checkedAt) => {
    const config = data?.result;
    const protocolVersion = finiteNumber(config?.protocol_version);
    if (!Number.isSafeInteger(protocolVersion) || protocolVersion !== Number(block.protocolVersion)) {
      throw new Error('Protocol-config version did not match the observed finalized block');
    }
    const ratio = config?.runtime_config?.transaction_costs?.burnt_gas_reward;
    const numerator = Array.isArray(ratio) ? finiteNumber(ratio[0]) : null;
    const denominator = Array.isArray(ratio) ? finiteNumber(ratio[1]) : null;
    const validRatio = Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator)
      && numerator >= 0 && denominator > 0 && numerator <= denominator;
    return {
      blockHeight: block.height, blockHash: block.hash ?? null, protocolVersion,
      burntGasReward: validRatio ? { numerator, denominator, contractRebatePct: numerator / denominator * 100, eligibleGasBurnPct: (denominator - numerator) / denominator * 100 } : null,
      gasLimit: finiteNumber(config?.gas_limit),
      minGasPriceYocto: /^\d+$/.test(String(config?.min_gas_price ?? '')) ? String(config.min_gas_price) : null,
      fetchedAt: checkedAt,
    };
  });
  if (result.value) result.status.providerAt = block.timestamp ?? null;
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

function parseOverviewChart(points, label) {
  const rows = (Array.isArray(points) ? points : []).map((point) => ({
    date: Array.isArray(point) ? toUtcDate(point[0], 's') : null,
    timestamp: Array.isArray(point) ? finiteNumber(point[0]) : null,
    valueUsd: Array.isArray(point) ? finiteNumber(point[1]) : null,
  })).filter((row) => row.date && row.timestamp !== null && row.timestamp > 0 && row.valueUsd !== null && row.valueUsd >= 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timestamp - b.timestamp);
  if (rows.length < 2) throw new Error(`DefiLlama returned fewer than two valid dated ${label} points`);
  return rows;
}

export async function fetchNearDexVolumeHistory() {
  const result = await sourceCall('defillama-near-dex-volume', () => getJson(LLAMA_DEX_OVERVIEW_URL), (data, fetchedAt) => {
    const rows = parseOverviewChart(data?.totalDataChart, 'NEAR DEX volume');
    const latestFullDay = rows.filter((row) => row.date < new Date().toISOString().slice(0, 10)).at(-1) ?? null;
    const breakdownRow = (Array.isArray(data?.totalDataChartBreakdown) ? data.totalDataChartBreakdown : [])
      .filter((point) => Array.isArray(point) && toUtcDate(point[0], 's') === latestFullDay?.date).at(-1);
    const latestFullDayBreakdown = breakdownRow?.[1] && typeof breakdownRow[1] === 'object' && !Array.isArray(breakdownRow[1])
      ? Object.entries(breakdownRow[1]).map(([protocol, valueUsd]) => ({ protocol, valueUsd: finiteNumber(valueUsd) }))
        .filter((item) => item.protocol && item.valueUsd !== null && item.valueUsd >= 0).sort((a, b) => b.valueUsd - a.valueUsd)
      : [];
    return { rows, latestFullDay: latestFullDay?.date ?? null, latestFullDayBreakdown, total24hUsd: finiteNumber(data?.total24h), fetchedAt };
  });
  const timestamps = result.value?.rows?.map((row) => row.timestamp) ?? [];
  if (timestamps.length) result.status.providerAt = parseProviderTimestamp(Math.max(...timestamps));
  return result;
}

export async function fetchNearFeesHistory() {
  const result = await sourceCall('defillama-near-fees', () => getJson(LLAMA_FEES_OVERVIEW_URL), (data, fetchedAt) => ({
    rows: parseOverviewChart(data?.totalDataChart, 'NEAR indexed fee'), fetchedAt,
  }));
  const timestamps = result.value?.rows?.map((row) => row.timestamp) ?? [];
  if (timestamps.length) result.status.providerAt = parseProviderTimestamp(Math.max(...timestamps));
  return result;
}

export async function fetchNearPoolSnapshot() {
  const result = await sourceCall('geckoterminal-near-pools', () => getJson(GECKOTERMINAL_POOLS_URL, {
    headers: { Accept: 'application/json;version=20230203' },
  }), (data, fetchedAt) => {
    if (!Array.isArray(data?.data) || !data.data.length) throw new Error('GeckoTerminal returned no NEAR pool records on page 1');
    const pools = data.data.map((item) => {
      const attributes = item?.attributes ?? {};
      const transactions = attributes.transactions?.h24 ?? {};
      return {
        id: String(item?.id ?? ''), address: String(attributes.address ?? ''), name: String(attributes.name ?? ''),
        dexId: String(item?.relationships?.dex?.data?.id ?? ''), createdAt: parseProviderTimestamp(attributes.pool_created_at),
        reserveUsd: finiteNumber(attributes.reserve_in_usd), volume24hUsd: finiteNumber(attributes.volume_usd?.h24),
        priceChange24hPct: finiteNumber(attributes.price_change_percentage?.h24),
        buys24h: finiteNumber(transactions.buys), sells24h: finiteNumber(transactions.sells),
        buyerAccounts24h: finiteNumber(transactions.buyers), sellerAccounts24h: finiteNumber(transactions.sellers),
        baseTokenPriceUsd: finiteNumber(attributes.base_token_price_usd), quoteTokenPriceUsd: finiteNumber(attributes.quote_token_price_usd),
      };
    }).filter((pool) => pool.id && pool.address && pool.name)
      .sort((a, b) => (b.reserveUsd ?? -1) - (a.reserveUsd ?? -1) || a.name.localeCompare(b.name));
    if (!pools.length) throw new Error('GeckoTerminal pool page had no complete address/name records');
    return { pools, page: 1, returnedCount: pools.length, fetchedAt };
  });
  if (result.value) result.status.providerAt = result.value.fetchedAt;
  return result;
}

export async function fetchNearProtocolTvls() {
  const sourceId = 'defillama-near-protocol-tvls';
  const checkedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const index = await getJson(LLAMA_PROTOCOLS_URL);
    if (!Array.isArray(index.data)) throw new Error('DefiLlama protocol index was not an array');
    const indexProtocols = index.data
      .filter((item) => typeof item?.slug === 'string' && item.slug && item.category !== 'CEX'
        && Array.isArray(item.chains) && item.chains.some((chain) => String(chain).toLowerCase() === 'near')
        && finiteNumber(item.chainTvls?.Near) >= 100_000)
      .sort((a, b) => finiteNumber(b.chainTvls?.Near) - finiteNumber(a.chainTvls?.Near))
      .map((item) => ({ slug: item.slug, name: String(item.name || item.slug), category: String(item.category || 'Unclassified'), nearTvlUsd: finiteNumber(item.chainTvls?.Near) }));
    const candidates = indexProtocols.slice(0, 8);
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
      value: { protocols, indexProtocols, fetchedAt: checkedAt, requestedCount: candidates.length, returnedCount: protocols.length, indexCount: indexProtocols.length },
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

export async function fetchNearStablecoinSupplyHistory() {
  const result = await sourceCall('defillama-near-stablecoin-history', () => getJson(LLAMA_NEAR_STABLECOIN_HISTORY_URL), (data, fetchedAt) => {
    if (!Array.isArray(data)) throw new Error('DefiLlama stablecoin history is not an array');
    const rows = data.map((row) => ({
      date: toUtcDate(row?.date, 's'),
      totalCirculatingPeggedUsd: finiteNumber(row?.totalCirculating?.peggedUSD),
      totalCirculatingUsdPeggedUsd: finiteNumber(row?.totalCirculatingUSD?.peggedUSD),
      totalMintedUsdPeggedUsd: finiteNumber(row?.totalMintedUSD?.peggedUSD),
    })).filter((row) => row.date && row.totalCirculatingPeggedUsd !== null && row.totalCirculatingPeggedUsd >= 0)
      .sort((left, right) => left.date.localeCompare(right.date));
    if (rows.length < 2) throw new Error('DefiLlama returned fewer than two valid dated NEAR stablecoin supply observations');
    return { rows, rawRows: data, fetchedAt };
  });
  const latestDate = result.value?.rows?.at(-1)?.date;
  if (latestDate) result.status.providerAt = `${latestDate}T00:00:00.000Z`;
  return result;
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
