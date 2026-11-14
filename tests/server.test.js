import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let localServer;
let localUrl;

async function startLocalServer() {
  localServer = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  return await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`Server did not become ready. Output: ${output}`)), 8_000);
    localServer.stdout.setEncoding('utf8');
    localServer.stderr.setEncoding('utf8');
    localServer.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/NEAR SIGNAL local server: http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        localUrl = `http://127.0.0.1:${match[1]}`;
        resolvePromise(localUrl);
      }
    });
    localServer.stderr.on('data', (chunk) => { output += chunk; });
    localServer.once('error', (error) => { clearTimeout(timer); rejectPromise(error); });
    localServer.once('exit', (code, signal) => {
      if (!localUrl) { clearTimeout(timer); rejectPromise(new Error(`Server exited before readiness (${code ?? signal}). Output: ${output}`)); }
    });
  });
}

after(async () => {
  if (!localServer || localServer.exitCode !== null) return;
  localServer.kill('SIGTERM');
  await Promise.race([once(localServer, 'exit'), new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))]);
});

test('local server serves the dashboard with restrictive headers and no API proxy', async () => {
  const base = await startLocalServer();
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  assert.match(page.headers.get('content-security-policy') || '', /connect-src.*free\.rpc\.fastnear\.com/);
  assert.match(page.headers.get('content-security-policy') || '', /connect-src.*stablecoins\.llama\.fi/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const html = await page.text();
  assert.match(html, /Transactions in latest complete sample/);
  assert.match(html, /id="thesisProvenance"/);
  assert.doesNotMatch(html, /id="methodology"/);
  assert.doesNotMatch(html, /PIKESPEAK_API_KEY/);

  const head = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal(await head.text(), '');

  const unknownApi = await fetch(`${base}/api/not-a-route`);
  assert.equal(unknownApi.status, 404);
  assert.match((await unknownApi.json()).error, /No API routes/);
  const wrongMethod = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
});

test('server refuses a non-loopback host before listening', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, HOST: '0.0.0.0', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const [code] = await once(child, 'exit');
  assert.notEqual(code, 0);
  assert.match(output, /bind to loopback only/);
});
