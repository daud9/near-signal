import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, retries: 0, timeout: 90_000,
  expect: { timeout: 25_000 },
  use: { baseURL: 'http://127.0.0.1:8001', viewport: { width: 1440, height: 1000 }, screenshot: 'off', video: 'off', trace: 'off' },
  webServer: { command: 'PORT=8001 node server.mjs', url: 'http://127.0.0.1:8001', reuseExistingServer: false },
});
