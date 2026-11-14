import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_SOURCES, parseProviderTimestamp } from '../src/data.js';

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
