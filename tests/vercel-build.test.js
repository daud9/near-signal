import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVercelStaticOutput, VERCEL_PUBLIC_FILES } from '../scripts/build-vercel.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
  });
}

test('Vercel static output contains only app assets and evidence documents reachable from the UI', () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'near-signal-vercel-'));
  const output = path.join(temporaryRoot, 'dist');
  try {
    assert.equal(buildVercelStaticOutput(output), output);
    assert.deepEqual(listFiles(output).sort(), [...VERCEL_PUBLIC_FILES].sort());

    for (const required of [
      'index.html',
      'src/app.js',
      'src/data.js',
      'src/workspace.css',
      'docs/methodology.md',
      'docs/risk-radar-research/README.md',
      'docs/risk-radar-research/03-liquidity-assets.md',
    ]) {
      assert.ok(existsSync(path.join(output, required)), `${required} must remain available to the app`);
    }

    for (const forbidden of [
      'data/latest-evidence.json',
      'data/replayed-charts.json',
      'tests/server.test.js',
      'e2e/workspace.spec.js',
      'README.md',
      'docs/implementation-status.md',
      'scripts/build-vercel.mjs',
      'server.mjs',
      'package.json',
      '.git/config',
    ]) {
      assert.ok(!existsSync(path.join(output, forbidden)), `${forbidden} must not be deployed`);
    }

    const config = JSON.parse(readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));
    assert.equal(config.buildCommand, 'npm run build:vercel');
    assert.equal(config.outputDirectory, 'dist');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
