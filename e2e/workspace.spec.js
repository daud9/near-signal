import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const routes = ['overview', 'value-capture', 'adoption', 'risk-radar', 'capital-flows', 'thesis-challenge', 'methodology'];

test('desktop workspace tools use live sources and all navigation/actions work end to end', async ({ page }) => {
  const errors = [], forbiddenRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/bigquery\.googleapis|explorer\.near-intents\.org\/api/.test(request.url())) forbiddenRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#finalizedBlock')).not.toHaveText('—');
  await expect(page.locator('#sourceList .source-row').filter({ hasText: 'FastNEAR Neardata' }).locator('.status-pill')).toHaveText('Responding');
  await expect(page.locator('#blockTxAsOf')).toContainText('shard chunks');
  await expect(page.locator('#overviewChart svg')).toBeVisible();
  for (const route of routes) {
    await page.locator(`.nav a[href="#${route}"]`).click();
    await expect(page.locator(`section#${route}`)).toBeVisible();
    await expect(page.locator('main > section.block:visible')).toHaveCount(1);
    await expect(page.locator(`.nav a[href="#${route}"]`)).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  await page.locator('#sqlStartDate').fill('2026-11-01'); await page.locator('#sqlEndDate').fill('2026-11-07');
  await page.getByRole('button', { name: 'Generate SQL', exact: true }).click();
  await expect(page.locator('#generatedSqlCode')).toContainText("DATE '2026-11-01'");
  const sqlDownload = page.waitForEvent('download'); await page.locator('#downloadSqlButton').click();
  expect(await readFile(await (await sqlDownload).path(), 'utf8')).toContain('block_date >= start_date AND block_date < end_date');

  await page.locator('.nav a[href="#risk-radar"]').click();
  const riskThreshold = page.locator('#riskThreshold');
  await riskThreshold.focus();
  for (let index = 0; index < 6; index += 1) await riskThreshold.press('ArrowRight');
  await expect(page.locator('#riskThresholdOutput')).toHaveText('50%');
  await page.locator('#riskFilter').selectOption('coverage');
  await expect(page.locator('#riskFilterStatus')).toContainText('of 6 indicators');
  await expect(page.locator('#riskGrid')).toContainText('Ecosystem dependencies');

  await page.locator('.nav a[href="#capital-flows"]').click();
  await page.locator('#capitalWindowSelect').selectOption('7');
  await expect(page.locator('#tvlDateSpan')).toContainText('8 complete matched dates');

  await page.locator('.nav a[href="#thesis-challenge"]').click();
  await page.locator('#metricB').selectOption('priceUsd');
  await expect(page.locator('#hypothesisVerdict')).toHaveText('Choose distinct series');
  await page.locator('#metricB').selectOption('tvlUsd');
  await page.locator('#runHypothesisButton').click();
  await expect(page.locator('#hypothesisSummary')).toContainText('Pearson r');
  const thesisDownload = page.waitForEvent('download'); await page.locator('#exportHypothesisButton').click();
  const result = JSON.parse(await readFile(await (await thesisDownload).path(), 'utf8'));
  expect(result.result.n).toBe(14); expect(result.rawCoinGeckoMarketChart.prices.length).toBeGreaterThan(14);
  const evidenceDownload = page.waitForEvent('download'); await page.locator('#exportButton').click();
  const evidence = JSON.parse(await readFile(await (await evidenceDownload).path(), 'utf8'));
  expect(evidence.onDemandAccountInspection.accountId).toBe('intents.near');
  expect(evidence.replayedChartInputs.capitalChart).toHaveLength(8);
  expect(forbiddenRequests).toEqual([]); expect(errors).toEqual([]);
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
