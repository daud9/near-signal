import test from 'node:test';
import assert from 'node:assert/strict';

const cacheToken = `?import-check=${Date.now()}`;

test('data adapters and rebuild module have no network side effects on import', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected network call during import'); };
  try {
    await import(`../src/data.js${cacheToken}`);
    await import(`../scripts/rebuild-data.mjs${cacheToken}`);
    const { createAppServer } = await import(`../server.mjs${cacheToken}`);
    assert.equal(typeof createAppServer, 'function');
    assert.throws(() => createAppServer({ host: '0.0.0.0', port: 0 }), /bind to loopback only/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
