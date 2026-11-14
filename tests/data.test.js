import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_SOURCES, fetchCoinGeckoHistory, fetchTvlHistory, fetchNearProtocolTvls, fetchNearStablecoins, parseProviderTimestamp } from '../src/data.js';

async function withJsonResponse(payload, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
  try { return await callback(); }
  finally { globalThis.fetch = originalFetch; }
}

test('provider timestamps normalize ISO-8601, Unix milliseconds, seconds and NEAR nanoseconds', () => {
  const expected = '2026-11-14T06:25:43.725Z';
  const milliseconds = Date.parse(expected);
  const expectedSeconds = new Date(Math.floor(milliseconds / 1000) * 1000).toISOString();
  const nanoseconds = String(BigInt(milliseconds) * 1_000_000n);
  assert.equal(parseProviderTimestamp('2026-11-14T06:25:43.725726293Z'), expected);
  assert.equal(parseProviderTimestamp(milliseconds), expected);
  assert.equal(parseProviderTimestamp(Math.floor(milliseconds / 1000)), expectedSeconds);
  assert.equal(parseProviderTimestamp(nanoseconds), expected);
});

test('invalid provider timestamps remain unavailable', () => {
  for (const value of [null, undefined, '', 0, '0', 'not-a-date', true]) {
    assert.equal(parseProviderTimestamp(value), null);
  }
});

test('all live NEAR RPC sources use the documented FastNear free mainnet endpoint', () => {
  const ids = new Set(['near-rpc-finalized', 'near-rpc-status', 'near-rpc-validators']);
  const sources = DATA_SOURCES.filter((source) => ids.has(source.id));
  assert.equal(sources.length, ids.size);
  for (const source of sources) assert.equal(source.url, 'https://free.rpc.fastnear.com');
  const neardata = DATA_SOURCES.find((source) => source.id === 'fastnear-neardata-block-transactions');
  assert.equal(neardata.connected, true);
  assert.match(neardata.url, /mainnet\.neardata\.xyz\/v0\/last_block\/final/);
  assert.match(neardata.caveat, /not a daily series/);
});

test('runtime source registry contains only connected feeds and gives daily history a freshness limit', () => {
  assert.equal(DATA_SOURCES.length, 10);
  assert.ok(DATA_SOURCES.every((source) => source.connected));
  for (const sourceId of ['coingecko-history', 'defillama-tvl']) {
    assert.equal(DATA_SOURCES.find((source) => source.id === sourceId)?.staleAfterSeconds, 172800);
  }
  assert.match(DATA_SOURCES.find((source) => source.id === 'defillama-near-protocol-tvls')?.url, /api\.llama\.fi\/protocols/);
  assert.match(DATA_SOURCES.find((source) => source.id === 'defillama-near-stablecoins')?.url, /stablecoins\.llama\.fi\/stablecoins\?includePrices=true/);
});

test('CoinGecko history rejects malformed arrays even when they contain two entries', async () => {
  const malformed = {
    prices: [['bad-timestamp', 2], [1000, null]],
    market_caps: [[1000, 1], [2000, 2]],
    total_volumes: [[1000, 1], [2000, 2]],
  };
  const result = await withJsonResponse(malformed, () => fetchCoinGeckoHistory());
  assert.equal(result.status.ok, false);
  assert.match(result.status.detail, /valid dated/);
  assert.equal(result.value, undefined);
});

test('CoinGecko history accepts usable price, market-cap and volume series', async () => {
  const valid = {
    prices: [[1000, 2], [2000, 3]],
    market_caps: [[1000, 20], [2000, 30]],
    total_volumes: [[1000, 10], [2000, 15]],
  };
  const result = await withJsonResponse(valid, () => fetchCoinGeckoHistory());
  assert.equal(result.status.ok, true);
  assert.equal(result.value.prices.length, 2);
});

test('DefiLlama TVL history rejects malformed dated values instead of reporting a healthy feed', async () => {
  const malformed = [{ date: 0, tvl: 10 }, { date: 2000, tvl: null }];
  const result = await withJsonResponse(malformed, () => fetchTvlHistory());
  assert.equal(result.status.ok, false);
  assert.match(result.status.detail, /valid dated TVL/);
  assert.equal(result.value, undefined);
});

test('DefiLlama TVL history accepts dated finite observations, including a legitimate zero', async () => {
  const valid = [{ date: 1000, tvl: 0 }, { date: 2000, tvl: 20 }];
  const result = await withJsonResponse(valid, () => fetchTvlHistory());
  assert.equal(result.status.ok, true);
  assert.equal(result.value.rows.length, 2);
});

test('NEAR stablecoin adapter preserves observed peg, price source and chain-specific circulation', async () => {
  const fixture = { peggedAssets: [
    { id: '54', name: 'USN', symbol: 'USN', pegType: 'peggedUSD', pegMechanism: 'algorithmic', priceSource: 'defillama', price: 0.086, gecko_id: 'usn', chainCirculating: { Near: { current: { peggedUSD: 69_854 }, circulatingPrevDay: { peggedUSD: 69_854 } } } },
    { id: '99', name: 'Other', symbol: 'OTHER', pegType: 'peggedUSD', price: 1, chainCirculating: { Ethereum: { current: { peggedUSD: 1_000_000 } } } },
  ] };
  const result = await withJsonResponse(fixture, fetchNearStablecoins);
  assert.equal(result.status.ok, true);
  assert.deepEqual(result.value.assets.map(({ id, symbol }) => ({ id, symbol })), [{ id: '54', symbol: 'USN' }]);
  assert.equal(result.value.assets[0].priceUsd, 0.086);
  assert.equal(result.value.assets[0].currentNearCirculationUsd, 69_854);
  assert.ok(Number.isFinite(Date.parse(result.value.fetchedAt)));
});

test('NEAR protocol adapter skips CEX rows and retains dated NEAR-only protocol history', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const isIndex = String(url) === 'https://api.llama.fi/protocols';
    const payload = isIndex ? [
      { slug: 'exchange-near', name: 'Exchange', category: 'CEX', chains: ['Near'], chainTvls: { Near: 5_000_000 } },
      { slug: 'near-lend', name: 'NEAR Lend', category: 'Lending', chains: ['Near'], chainTvls: { Near: 2_000_000 } },
      { slug: 'other', name: 'Other', category: 'Lending', chains: ['Ethereum'], chainTvls: { Near: 1_000_000 } },
    ] : { name: 'NEAR Lend', chainTvls: { Near: { tvl: [{ date: 1_700_000_000, totalLiquidityUSD: 2_000_000 }, { date: 1_700_086_400, totalLiquidityUSD: 1_900_000 }] } } };
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    const result = await fetchNearProtocolTvls();
    assert.equal(result.status.ok, true);
    assert.equal(result.value.protocols.length, 1);
    assert.equal(result.value.protocols[0].slug, 'near-lend');
    assert.equal(result.value.protocols[0].points.length, 2);
    assert.equal(result.status.partial, false);
    assert.ok(requests.every((url) => !url.includes('exchange-near')));
    assert.ok(requests.every((url) => !url.endsWith('/other')));
  } finally { globalThis.fetch = originalFetch; }
});

test('NEAR protocol adapter exposes partial history coverage when a selected request fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === 'https://api.llama.fi/protocols') return { ok: true, status: 200, json: async () => [
      { slug: 'working-near-app', name: 'Working App', category: 'Lending', chains: ['Near'], chainTvls: { Near: 800_000 } },
      { slug: 'missing-near-app', name: 'Missing App', category: 'Dexes', chains: ['Near'], chainTvls: { Near: 700_000 } },
    ] };
    if (value.endsWith('/missing-near-app')) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ name: 'Working App', chainTvls: { Near: { tvl: [
      { date: 1_700_000_000, totalLiquidityUSD: 800_000 }, { date: 1_700_086_400, totalLiquidityUSD: 790_000 },
    ] } } }) };
  };
  try {
    const result = await fetchNearProtocolTvls();
    assert.equal(result.status.ok, true);
    assert.equal(result.status.partial, true);
    assert.match(result.status.detail, /1\/2 selected histories returned/);
    assert.equal(result.value.requestedCount, 2);
    assert.equal(result.value.returnedCount, 1);
    assert.deepEqual(result.value.protocols.map((item) => item.slug), ['working-near-app']);
  } finally { globalThis.fetch = originalFetch; }
});
