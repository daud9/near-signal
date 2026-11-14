import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const routes = ['overview', 'thesis-challenge', 'risk-radar', 'flight-recorder', 'value-capture', 'adoption', 'capital-flows'];

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
  await expect(page.locator('#tvlDateSpan')).toContainText('8 complete daily observations');

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
  await page.locator('#menuToggle').click();
  await page.locator('.nav a[href="#flight-recorder"]').click();
  await expect(page.locator('#flight-recorder')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#menuToggle').click(); await page.keyboard.press('Escape');
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'false');
});

test('expanded liquidity, validator, shard and value-capture panels render only fixture-backed live fields', async ({ page }) => {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const dates = Array.from({ length: 40 }, (_, index) => new Date(dayStart.getTime() - (40 - index) * 86_400_000));
  const seconds = dates.map((date) => Math.floor(date.getTime() / 1000));
  const dailyDex = seconds.map((timestamp, index) => [timestamp, 10_000 + index * 100]);
  const dailyFees = seconds.map((timestamp, index) => [timestamp, 800 + index * 10]);
  const dailyTvl = seconds.map((date, index) => ({ date, tvl: 5_000_000 + index * 20_000 }));
  const protocolPoints = seconds.map((date, index) => ({ date, totalLiquidityUSD: 900_000 + index * 1_000 }));
  const marketPoints = dates.map((date, index) => [date.getTime(), 3 + index * 0.01]);
  const nowSeconds = Math.floor(Date.now() / 1000), nowNs = String(BigInt(Date.now()) * 1_000_000n), yocto = 10n ** 24n;

  await page.route('https://api.llama.fi/overview/dexs/Near', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totalDataChart: dailyDex, totalDataChartBreakdown: [[dailyDex.at(-1)[0], { Rhea: dailyDex.at(-1)[1] }]], total24h: dailyDex.at(-1)[1] }) }));
  await page.route('https://api.llama.fi/overview/fees/Near', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totalDataChart: dailyFees }) }));
  await page.route('https://api.llama.fi/v2/historicalChainTvl/near', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dailyTvl) }));
  await page.route('https://api.llama.fi/protocols', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { slug: 'fixture-near-one', name: 'Fixture NEAR One', category: 'Lending', chains: ['Near'], chainTvls: { Near: 950_000 } },
    { slug: 'fixture-near-two', name: 'Fixture NEAR Two', category: 'Dexes', chains: ['Near'], chainTvls: { Near: 850_000 } },
  ]) }));
  await page.route('https://api.llama.fi/protocol/**', (route) => {
    const name = route.request().url().endsWith('fixture-near-one') ? 'Fixture NEAR One' : 'Fixture NEAR Two';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name, chainTvls: { Near: { tvl: protocolPoints } } }) });
  });
  await page.route('https://api.llama.fi/coins/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ coins: { 'coingecko:near': { price: 3.1, timestamp: nowSeconds, confidence: 0.9 } } }) }));
  await page.route('https://stablecoins.llama.fi/stablecoins?includePrices=true', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ peggedAssets: [] }) }));
  await page.route(/https:\/\/api\.geckoterminal\.com\/api\/v2\/networks\/near\/pools\?page=1/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{
    id: 'near_fixture_pool', attributes: { address: '0xfixturepool', name: 'wNEAR / USDC', reserve_in_usd: '250000', volume_usd: { h24: '75000' }, price_change_percentage: { h24: '2.5' }, transactions: { h24: { buys: 12, sells: 8, buyers: 9, sellers: 7 } } },
    relationships: { dex: { data: { id: 'fixture-dex' } } },
  }] }) }));
  await page.route('https://api.coingecko.com/api/v3/simple/price**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ near: { usd: 3.1, usd_market_cap: 1_000_000_000, usd_24h_vol: 50_000_000, usd_24h_change: 1.2, last_updated_at: nowSeconds } }) }));
  await page.route('https://api.coingecko.com/api/v3/coins/near/market_chart**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prices: marketPoints, market_caps: marketPoints.map(([time, value]) => [time, value * 1e9]), total_volumes: marketPoints.map(([time, value]) => [time, value * 1e7]) }) }));
  await page.route('https://mainnet.neardata.xyz/v0/block/*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    block: { header: { height: 100, hash: 'fixture-block-hash' }, chunks: [{ shard_id: 0, chunk_hash: 'fixture-chunk-0', height_included: 100 }] },
    shards: [{ shard_id: 0, chunk: { header: { chunk_hash: 'fixture-chunk-0', height_included: 100 }, transactions: [{ transaction: { hash: 'fixture-tx-1' } }, { transaction: { hash: 'fixture-tx-2' } }] } }],
  }) }));
  await page.route('https://free.rpc.fastnear.com', async (route) => {
    const request = route.request().postDataJSON(); let result;
    if (request.method === 'block') result = { header: { height: 100, hash: 'fixture-block-hash', epoch_id: 'fixture-epoch', timestamp: nowNs, gas_price: '100000000', latest_protocol_version: 88 }, chunks: [{ shard_id: 0, chunk_hash: 'fixture-chunk-0', height_included: 100, gas_used: '1000000000000', gas_limit: '10000000000000' }] };
    else if (request.method === 'EXPERIMENTAL_protocol_config') result = { protocol_version: 88, gas_limit: '1000000', min_gas_price: '100', runtime_config: { transaction_costs: { burnt_gas_reward: [0, 1] } } };
    else if (request.method === 'validators') result = {
      epoch_height: 50,
      current_validators: [{ account_id: 'validator-a.near', stake: String(100n * yocto), num_produced_blocks: 90, num_expected_blocks: 100, num_produced_chunks: 80, num_expected_chunks: 100, num_produced_endorsements: 70, num_expected_endorsements: 100, is_slashed: false }],
      next_validators: [{ account_id: 'validator-a.near', stake: String(100n * yocto), shards: [0] }, { account_id: 'validator-b.near', stake: String(50n * yocto), shards: [0] }],
      current_proposals: [{ account_id: 'proposal.near' }], current_fishermen: [], prev_epoch_kickout: [], validator_reward_paid_prev_epoch: { 'validator-a.near': String(2n * yocto) },
    };
    else if (request.method === 'status') result = { chain_id: 'mainnet', syncing: false, sync_info: { latest_block_height: 100, latest_block_time: nowNs } };
    else result = {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
  });

  await page.goto('/#value-capture');
  await expect(page.locator('#latestFeeDaily')).not.toHaveText('Unavailable');
  await expect(page.locator('#fees7d')).not.toHaveText('Unavailable');
  await expect(page.locator('#contractRebateShare')).toHaveText('0.0%');
  await expect(page.locator('#eligibleGasBurnShare')).toHaveText('100.0%');
  await expect(page.locator('#validatorRewardPaid')).toContainText('2');
  await expect(page.locator('#feeHistoryChart svg')).toBeVisible();
  await expect(page.locator('#shardGasTable .data-table tbody tr')).toHaveCount(1);
  await page.locator('#feeHistoryChart .chart-query summary').click();
  await expect(page.locator('#feeHistoryChart .chart-query')).toContainText('/overview/fees/Near');

  await page.locator('.nav a[href="#adoption"]').click();
  await expect(page.locator('#validatorCurrentTable')).toContainText('validator-a.near');
  await expect(page.locator('#validatorNextTable')).toContainText('validator-b.near');
  await expect(page.locator('#validatorSetTransition')).toContainText('1 added');
  await expect(page.locator('#shardActivityTable')).toContainText('2');

  await page.locator('.nav a[href="#capital-flows"]').click();
  await page.locator('#capitalWindowSelect').selectOption('30');
  await expect(page.locator('#tvlDateSpan')).toContainText('31 complete daily observations');
  await expect(page.locator('#dex7d')).not.toHaveText('Unavailable');
  await expect(page.locator('#dexVolumeChart svg')).toBeVisible();
  await expect(page.locator('#dexBreakdownTable')).toContainText('Rhea');
  await expect(page.locator('#nearPoolTable')).toContainText('wNEAR / USDC');
  await expect(page.locator('#poolPageReserves')).toContainText('250');
  await expect(page.locator('#protocolIndexTable')).toContainText('Fixture NEAR One');
  await expect(page.locator('#protocolHistoryTable')).toContainText('Fixture NEAR Two');
  await expect(page.locator('#protocolHistoryTable')).toContainText('7-day change');
  await page.locator('.nav a[href="#flight-recorder"]').click();
  await expect(page.locator('#flightBlockHeight')).toHaveText('100');
  await expect(page.locator('#flightSampleTx')).toHaveText('2');
  await expect(page.locator('#flightShardTable')).toContainText('2');
  await expect(page.locator('#flightShardChart .shard-fingerprint-row')).toHaveCount(1);
  await expect(page.locator('#flightShardStatus')).toHaveText('All shard chunks verified');
  await expect(page.locator('#flightTurnover')).not.toHaveText('Unavailable');
  await expect(page.locator('#flightIndexTop3')).not.toHaveText('Unavailable');
  await expect(page.locator('#flightRecorderReadout')).toContainText('2 verified transactions');
  await page.locator('#flightMethod summary').click();
  await expect(page.locator('#flightRecipeText')).toContainText('api.llama.fi/overview/dexs/Near');
  const flightDownload = page.waitForEvent('download'); await page.locator('#flightExportButton').click();
  const flightBundle = JSON.parse(await readFile(await (await flightDownload).path(), 'utf8'));
  expect(flightBundle.selectedBlock.execution.transactionSampleVerified).toBe(true);
  expect(flightBundle.selectedBlock.execution.shards[0].transactionCount).toBe(2);
  expect(flightBundle.replayed.flightRecorderSamples[0].transactionSampleVerified).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
