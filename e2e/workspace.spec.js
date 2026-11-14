import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const routes = ['overview', 'thesis-challenge', 'risk-radar', 'value-capture', 'adoption', 'capital-flows'];

test('desktop workspace tools use live sources and all navigation/actions work end to end', async ({ page }) => {
  const errors = [], forbiddenRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/explorer\.near-intents\.org\/api/.test(request.url())) forbiddenRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#finalizedBlock')).toHaveText(/^\d+(?:\.\d+)?[KMB]?$/);
  await expect(page.locator('#overviewChart svg')).toBeVisible();
  for (const route of routes) {
    await page.locator(`.nav a[href="#${route}"]`).click();
    await expect(page.locator(`section#${route}`)).toBeVisible();
    await expect(page.locator('main > section.block:visible')).toHaveCount(1);
    await expect(page.locator(`.nav a[href="#${route}"]`)).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (route === 'adoption') await expect(page.locator('#blockTxAsOf')).toContainText(/new chunks|Waiting for|Unavailable|failed/);
  }
  await page.locator('.nav a[href="#overview"]').click();
  await page.locator('#windowSelect').selectOption('7');
  await page.locator('[data-chart-metric="tvlUsd"]').click();
  await expect(page.locator('#observedSpan')).toContainText('8 matched dates');
  const csvDownload = page.waitForEvent('download');
  await page.locator('#overviewChart [data-download-chart]').click();
  const csv = await readFile(await (await csvDownload).path(), 'utf8');
  expect(csv.trim().split('\n')).toHaveLength(9);
  expect(csv).toContain('TVL');

  await page.locator('.nav a[href="#value-capture"]').click();
  await page.locator('#feeGasInput').fill('200');
  await page.getByRole('button', { name: 'Calculate cost', exact: true }).click();
  await expect(page.locator('#feeEstimateNear')).not.toHaveText('Unavailable');
  expect(Number((await page.locator('#feeEstimateNear').innerText()).split(' ')[0])).toBeGreaterThan(0);

  await page.locator('.nav a[href="#adoption"]').click();
  await page.locator('#accountIdInput').fill('intents.near');
  await page.locator('#inspectAccountButton').click();
  await expect(page.locator('#accountInspectorStatus')).toHaveText('Finalized account state');
  await expect(page.locator('#accountInspectorResult')).toContainText('intents.near');
  await expect(page.locator('#accountInspectorResult')).toContainText('Yes');
  await expect(page.locator('#sqlBuilderForm')).toHaveCount(0);

  await page.locator('.nav a[href="#risk-radar"]').click();
  await expect(page.locator('#riskGrid')).toContainText('FastNEAR Neardata');
  await expect(page.locator('#riskGrid .risk-source-item').filter({ hasText: 'FastNEAR Neardata' })).toContainText(/Responding|stale|retained/i);
  await expect(page.locator('#riskGrid')).not.toContainText('Ecosystem dependencies');
  const economics = page.locator('#riskGrid .risk-card').filter({ hasText: '24-hour NEAR market change' });
  if (await economics.count()) {
    await expect(economics.locator('.risk-source')).toContainText('CoinGecko');
    await expect(economics.locator('p').filter({ hasText: 'Evidence:' })).toContainText(/CoinGecko reported NEAR.*% over 24 hours/);
  }
  const riskThreshold = page.locator('#riskThreshold');
  await riskThreshold.focus();
  for (let index = 0; index < 6; index += 1) await riskThreshold.press('ArrowRight');
  await expect(page.locator('#riskThresholdOutput')).toHaveText('50%');
  await page.locator('#riskFilter').selectOption('alerts');
  await expect(page.locator('#riskFilterStatus')).toContainText('live signals');
  await expect(page.locator('#riskFilter')).not.toContainText('Evidence gaps');

  await page.locator('.nav a[href="#capital-flows"]').click();
  await page.locator('#capitalWindowSelect').selectOption('7');
  await expect(page.locator('#tvlDateSpan')).toContainText('8 complete matched dates');

  await page.locator('.nav a[href="#thesis-challenge"]').click();
  await page.locator('#metricB').selectOption('priceUsd');
  await expect(page.locator('#hypothesisVerdict')).toHaveText('Choose distinct series');
  await page.locator('#metricB').selectOption('tvlUsd');
  await page.locator('#runHypothesisButton').click();
  await expect(page.locator('#hypothesisSummary')).toContainText('Pearson r');
  await page.locator('#thesisProvenance summary').click();
  await expect(page.locator('#thesisSourceQuery')).toContainText('api.coingecko.com');
  await expect(page.locator('#thesisMethodList')).toContainText('Pearson correlation');
  await expect(page.locator('#thesisSourceStatus')).toContainText('DefiLlama');
  const thesisDownload = page.waitForEvent('download'); await page.locator('#exportHypothesisButton').click();
  const result = JSON.parse(await readFile(await (await thesisDownload).path(), 'utf8'));
  expect(result.result.n).toBe(14); expect(result.rawInputs.coinGeckoMarketChart.prices.length).toBeGreaterThan(14);
  expect(result.provenance.recipe.query).toContain('api.coingecko.com');
  expect(result.provenance.sourceStatuses).toHaveLength(2);
  const evidenceDownload = page.waitForEvent('download'); await page.locator('#exportButton').click();
  const evidence = JSON.parse(await readFile(await (await evidenceDownload).path(), 'utf8'));
  expect(evidence.onDemandAccountInspection.accountId).toBe('intents.near');
  expect(evidence.replayedChartInputs.capitalChart).toHaveLength(8);
  expect(forbiddenRequests).toEqual([]); expect(errors).toEqual([]);
});

test('Risk Radar renders observed stablecoin and NEAR protocol TVL findings from live-schema responses', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  const dailyTvl = Array.from({ length: 8 }, (_, index) => ({ date: now - (7 - index) * 86_400, totalLiquidityUSD: 10_000_000 - index * 500_000 }));
  await page.route('https://stablecoins.llama.fi/stablecoins?includePrices=true', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ peggedAssets: [{
      id: 'test-usn', name: 'Test USD NEAR', symbol: 'TUSD', pegType: 'peggedUSD', pegMechanism: 'algorithmic', priceSource: 'test-market', price: 0.8,
      chainCirculating: { Near: { current: { peggedUSD: 100_000 } } },
    }] }),
  }));
  await page.route('https://api.llama.fi/protocols', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([
      { slug: 'test-near-app', name: 'Test NEAR App', category: 'Lending', chains: ['Near'], chainTvls: { Near: 6_500_000 } },
      { slug: 'failed-near-app', name: 'Failed NEAR App', category: 'Dexes', chains: ['Near'], chainTvls: { Near: 5_000_000 } },
    ]),
  }));
  await page.route('https://api.llama.fi/protocol/failed-near-app', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.route('https://api.llama.fi/protocol/test-near-app', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'Test NEAR App', chainTvls: { Near: { tvl: dailyTvl } } }),
  }));
  await page.goto('/#risk-radar');
  const stablecoin = page.locator('#riskGrid .risk-card').filter({ hasText: 'Test USD NEAR' });
  await expect(stablecoin).toContainText('Critical peg deviation');
  await expect(stablecoin).toContainText('$0.8000');
  await expect(stablecoin).toContainText('DefiLlama — stablecoin');
  await expect(stablecoin).toContainText('stablecoins.llama.fi/stablecoins?includePrices=true');
  const protocol = page.locator('#riskGrid .risk-card').filter({ hasText: 'Test NEAR App' });
  await expect(protocol).toContainText('TVL drawdown threshold crossed');
  await expect(protocol).toContainText('35.0%');
  await expect(protocol).toContainText('api.llama.fi/protocol/test-near-app');
  await expect(protocol).toContainText('1/2 selected histories returned');
  await expect(page.locator('#riskRules')).toContainText('APY coverage');
});

test('historical TVL beyond its freshness threshold is visibly marked stale', async ({ page }) => {
  const midnightUtc = new Date();
  midnightUtc.setUTCHours(0, 0, 0, 0);
  const rows = [];
  for (let ageDays = 35; ageDays >= 5; ageDays -= 1) {
    rows.push({ date: Math.floor((midnightUtc.getTime() - ageDays * 86_400_000) / 1000), tvl: 100_000_000 + ageDays * 1000 });
  }
  await page.route('https://api.llama.fi/v2/historicalChainTvl/near', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }));
  await page.goto('/#capital-flows');
  await expect(page.locator('#capitalStatus')).toHaveText('Stale TVL snapshot');
  await expect(page.locator('#capitalStatus')).toHaveClass(/warn/);
  await expect(page.locator('#capitalLastChecked')).toContainText('provider observation is stale');
});

test('failed public feeds show unavailable values and explain the failed reads', async ({ page }) => {
  const fail = (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'provider unavailable' });
  await page.route(/^https:\/\/free\.rpc\.fastnear\.com\/?$/, fail);
  await page.route('https://api.coingecko.com/**', fail);
  await page.route('https://coins.llama.fi/**', fail);
  await page.route('https://api.llama.fi/**', fail);
  await page.goto('/#overview');
  await expect(page.locator('#finalizedBlock')).toHaveText('Unavailable');
  await expect(page.locator('#finalizedBlockFoot')).toContainText('Latest RPC read failed');
  await expect(page.locator('#marketPrice')).toHaveText('Unavailable');
  await expect(page.locator('#marketPriceFoot')).toContainText('read failed');
  await expect(page.locator('#marketChange')).toHaveText('Unavailable');
  await expect(page.locator('#feedStatus')).toContainText('source checks failed');
});

test('mobile side menu opens, routes, closes and does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#value-capture');
  await expect(page.locator('#value-capture')).toBeVisible();
  await expect(page.locator('#menuToggle')).toBeVisible();
  await page.locator('#menuToggle').click();
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.nav a[href="#adoption"]').click();
  await expect(page.locator('#adoption')).toBeVisible();
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#menuToggle').click(); await page.keyboard.press('Escape');
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'false');
});
