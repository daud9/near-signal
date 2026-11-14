import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_SOURCES, fetchCoinGeckoHistory, fetchTvlHistory, parseProviderTimestamp } from '../src/data.js';

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
  assert.equal(DATA_SOURCES.length, 8);
  assert.ok(DATA_SOURCES.every((source) => source.connected));
  for (const sourceId of ['coingecko-history', 'defillama-tvl']) {
    assert.equal(DATA_SOURCES.find((source) => source.id === sourceId)?.staleAfterSeconds, 172800);
  }
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
