import { alignMarketAndTvl, assessLiveRisks, formatSignedPercent, testHypothesis, toUtcDate, windowChange } from './analytics.js';
import { DATA_SOURCES, fetchNeardataBlockTransactionCount, fetchCoinGeckoHistory, fetchCoinGeckoMarket, fetchDefiLlamaPrice, fetchFinalizedBlock, fetchRpcStatus, fetchTvlHistory, fetchValidatorSet, fetchAccountSnapshot } from './data.js';
import { BIGQUERY_ACTIVITY_QUERY, BIGQUERY_DATASET, BIGQUERY_INSPECTED_FIELDS, BIGQUERY_INSPECTED_TABLES, BIGQUERY_REBUILD_NOTE, CHART_QUERY_RECIPES, THESIS_TEST_RECIPE } from './query-registry.js';

import { replayChartInputs, replayRpcObservations } from './replay.js';
import { WORKSPACES, resolveWorkspace, isNearAccountId, buildActivitySql, estimateExecutionCost, toCsv } from './workspace.js';
import { createThesisTestEvidence } from './thesis.js';
const chartExportData = new Map();
let generatedSql = '';
let accountInspection = null;
let lastAccountRequestAt = 0;

const LOCAL_HISTORY_KEY = 'near-signal.rpc-observations.v2';
const MAX_LOCAL_OBSERVATIONS = 60;
const $ = (selector) => document.querySelector(selector);
const state = {
  market: null, marketChart: null, llamaPrice: null, tvlHistory: null, blockActivity: null,
  block: null, rpcStatus: null, validators: null, sourceStatuses: new Map(), observations: readObservations(),
  chartMetric: 'priceUsd', days: 14, declineThreshold: 20, isRefreshing: false, rpcBusy: false, lastMarketRefresh: 0, lastChunkRequestAt: 0,
  inFlight: new Set(), failureCounts: new Map(), retryAt: new Map(),
};
const METRICS = {
  priceUsd: { label: 'Daily NEAR price', color: '#167965', format: 'usd' },
  tvlUsd: { label: 'Daily NEAR DeFi TVL', color: '#197e78', format: 'usd' },
  grossVolumeUsd: { label: 'Daily gross market volume', color: '#426da9', format: 'usd' },
};
const FAST_INTERVAL_MS = 60_000;
const BLOCK_TRANSACTION_INTERVAL_MS = 300_000;
const DEFI_PRICE_INTERVAL_MS = 120_000;
const SLOW_RPC_INTERVAL_MS = 300_000;
const TVL_INTERVAL_MS = 1_800_000;
const MARKET_MANUAL_COOLDOWN_MS = 60_000;
const FIELD_SOURCE_IDS = { block: 'near-rpc-finalized', blockActivity: 'fastnear-neardata-block-transactions', rpcStatus: 'near-rpc-status', validators: 'near-rpc-validators', market: 'coingecko-market', marketChart: 'coingecko-history', llamaPrice: 'defillama-price', tvlHistory: 'defillama-tvl' };
const RISK_SOURCE_IDS = {
  concentration: ['near-rpc-validators'], activity: ['fastnear-neardata-block-transactions'],
  capital: ['defillama-tvl', 'coingecko-history'], infrastructure: ['near-rpc-finalized', 'near-rpc-status'],
  economics: ['coingecko-market', 'near-rpc-finalized'],
};

function readObservations() {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY) || '[]');
    return Array.isArray(rows) ? replayRpcObservations(rows).slice(-MAX_LOCAL_OBSERVATIONS) : [];
  } catch { return []; }
}
function persistObservations() { try { localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(state.observations.slice(-MAX_LOCAL_OBSERVATIONS))); } catch { /* Browser storage may be disabled. */ } }
function mergeSourceStatus(status) { if (status?.sourceId) state.sourceStatuses.set(status.sourceId, status); }
function applyResult(field, result) { if (Object.hasOwn(result ?? {}, 'value')) state[field] = result.value; mergeSourceStatus(result?.status); }
function appendBlockObservation(block) {
  if (!block || !Number.isFinite(block.height)) return;
  const existing = state.observations.find((row) => row.height === block.height);
  const observation = {
    observedAt: existing?.observedAt ?? block.fetchedAt ?? new Date().toISOString(),
    rawBlock: block.raw ?? existing?.rawBlock,
    rawChunks: block.rawChunks ?? existing?.rawChunks ?? null,
    transactionFetchedAt: block.transactionFetchedAt ?? existing?.transactionFetchedAt ?? null,
  };
  state.observations = replayRpcObservations([...state.observations.filter((row) => row.height !== block.height), observation]).slice(-MAX_LOCAL_OBSERVATIONS);
  persistObservations();
}
function allDailyRows() {
  return state.marketChart && state.tvlHistory?.rows ? alignMarketAndTvl(state.tvlHistory.rows, state.marketChart) : [];
}
function hypothesisRows() {
  const today = new Date().toISOString().slice(0, 10);
  const series = { priceUsd: new Map(), marketCapUsd: new Map(), grossVolumeUsd: new Map(), tvlUsd: new Map() };
  const addMarketPairs = (field, points) => {
    for (const point of points ?? []) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const date = toUtcDate(point[0], 'ms'), value = Number(point[1]);
      if (date && date < today && Number.isFinite(value)) series[field].set(date, value);
    }
  };
  addMarketPairs('priceUsd', state.marketChart?.prices);
  addMarketPairs('marketCapUsd', state.marketChart?.market_caps);
  addMarketPairs('grossVolumeUsd', state.marketChart?.total_volumes);
  for (const row of state.tvlHistory?.rows ?? []) {
    const date = toUtcDate(row?.date, 's'), value = Number(row?.tvl);
    if (date && date < today && Number.isFinite(value)) series.tvlUsd.set(date, value);
  }
  const dates = [...new Set(Object.values(series).flatMap((values) => [...values.keys()]))].sort();
  return dates.map((date) => ({ date, ...Object.fromEntries(Object.entries(series).map(([field, values]) => [field, values.has(date) ? values.get(date) : null])) }));
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function compact(value, digits = 1) { const number = Number(value); return Number.isFinite(number) ? new Intl.NumberFormat('en-US', { notation: Math.abs(number) >= 1000 ? 'compact' : 'standard', maximumFractionDigits: digits }).format(number) : '—'; }
function usd(value, digits = 2) { const number = Number(value); return Number.isFinite(number) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(number) : 'Unavailable'; }
function shortUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) >= 1e9) return `$${(number / 1e9).toFixed(2)}B`;
  if (Math.abs(number) >= 1e6) return `$${(number / 1e6).toFixed(1)}M`;
  if (Math.abs(number) >= 1e3) return `$${(number / 1e3).toFixed(0)}K`;
  return usd(number, number < 1 ? 4 : 2);
}
function utcDateTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))} UTC`;
}
function ago(iso) {
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis)) return 'time unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - millis) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}
function sourceIsStale(status) {
  const source = DATA_SOURCES.find((item) => item.id === status?.sourceId);
  const observedAt = Date.parse(status?.providerAt ?? status?.lastProviderAt);
  return Boolean(source?.staleAfterSeconds && Number.isFinite(observedAt) && Date.now() - observedAt > source.staleAfterSeconds * 1000);
}
function titleCaseDirection(direction) { return direction === 'negative' ? 'negative co-movement' : 'positive co-movement'; }
function valueForChart(metric, row) { const raw = row?.[metric]; if (raw === null || raw === undefined || raw === '') return null; const value = Number(raw); return Number.isFinite(value) ? value : null; }
function chartLabel(value, format) {
  if (format === 'usd') return shortUsd(value);
  if (format === 'tgas') return `${Number(value).toFixed(1)} Tgas`;
  if (format === 'percent') return `${Number(value).toFixed(1)}%`;
  return compact(value);
}
function chartQueryDisclosure(chartId) {
  const recipe = CHART_QUERY_RECIPES[chartId];
  if (!recipe) return '';
  return `<div class="source-toolbar"><button class="button" type="button" data-download-chart="${escapeHtml(chartId)}">Download chart CSV</button></div><details class="chart-query"><summary>View source query and interpretation</summary><div class="query-content"><p><strong>What it shows:</strong> ${escapeHtml(recipe.plainLanguage)}</p><p><strong>Source:</strong> ${escapeHtml(recipe.source)}</p><pre><code>${escapeHtml(recipe.query)}</code></pre><button class="button" type="button" data-copy-query="${escapeHtml(chartId)}">Copy source query</button><p class="timestamp">Rebuild rule: repeat the source request above and apply the stated date matching or validation steps. No missing value is filled. Export evidence, then run <code>npm run replay -- path/to/evidence.json</code> to reconstruct plotted inputs offline from the saved raw responses.</p></div></details>`;
}
function renderLineChart(container, rows, metric, { label, color = '#c8f27c', format = 'usd', dateKey = 'date', emptyText = 'Waiting for observations', yLabel = null } = {}) {
  if (!container) return;
  const queryWasOpen = container.querySelector('.chart-query')?.open ?? false;
  const points = (rows ?? []).map((row) => ({ row, value: valueForChart(metric, row), date: row?.[dateKey] })).filter((point) => point.value !== null && point.date);
  chartExportData.set(container.id, { metric, label, points: points.map(({ date, value }) => ({ date, value })) });
  if (points.length < 1) { container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyText)}</div>${chartQueryDisclosure(container.id)}`; const disclosure = container.querySelector('.chart-query'); if (disclosure) disclosure.open = queryWasOpen; return; }
  const width = 720, height = 220, margin = { top: 12, right: 18, bottom: 34, left: 64 };
  const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  let minValue = Math.min(...points.map((point) => point.value)), maxValue = Math.max(...points.map((point) => point.value));
  if (minValue === maxValue) { const padding = Math.abs(minValue) * .04 || 1; minValue -= padding; maxValue += padding; }
  const padding = (maxValue - minValue) * .08; minValue -= padding; maxValue += padding;
  const utcTimes = dateKey === 'date' ? points.map((point) => Date.parse(`${String(point.date).slice(0, 10)}T00:00:00Z`)) : [];
  const firstMs = utcTimes[0], spanMs = utcTimes.at(-1) - firstMs;
  const useUtcSpacing = utcTimes.length === points.length && utcTimes.every(Number.isFinite) && spanMs > 0;
  const x = (index) => useUtcSpacing ? margin.left + (utcTimes[index] - firstMs) / spanMs * plotWidth : margin.left + (points.length === 1 ? 0.5 : index / (points.length - 1)) * plotWidth;
  const y = (value) => margin.top + (maxValue - value) / (maxValue - minValue) * plotHeight;
  const gapBefore = (index) => useUtcSpacing && index > 0 && (utcTimes[index] - utcTimes[index - 1]) !== 86_400_000;
  const hasGap = points.some((_, index) => gapBefore(index));
  const path = points.map((point, index) => `${index && !gapBefore(index) ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const grid = [0, 1, 2, 3].map((index) => {
    const yy = margin.top + index / 3 * plotHeight, value = maxValue - index / 3 * (maxValue - minValue);
    return `<line x1="${margin.left}" y1="${yy.toFixed(1)}" x2="${width - margin.right}" y2="${yy.toFixed(1)}" stroke="#dce6e2" stroke-width="1"/><text x="${margin.left - 8}" y="${(yy + 3).toFixed(1)}" fill="#667a73" text-anchor="end" font-size="9">${escapeHtml(chartLabel(value, format))}</text>`;
  }).join('');
  const firstDate = String(points[0].date).slice(0, 10), lastDate = String(points.at(-1).date).slice(0, 10);
  const area = hasGap ? '' : `${path} L${x(points.length - 1).toFixed(1)},${(height - margin.bottom).toFixed(1)} L${x(0).toFixed(1)},${(height - margin.bottom).toFixed(1)} Z`;
  const circles = points.map((point, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="2.2" fill="${color}"><title>${escapeHtml(String(point.date))}: ${escapeHtml(chartLabel(point.value, format))}</title></circle>`).join('');
  const tableRows = points.map((point) => {
    const exactDate = String(point.date);
    return `<tr><td><time datetime="${escapeHtml(exactDate)}">${escapeHtml(utcDateTime(exactDate))}</time></td><td>${escapeHtml(chartLabel(point.value, format))}</td></tr>`;
  }).join('');
  const table = `<details class="chart-data"><summary>View data table (${points.length} observations)</summary><div class="chart-table-wrap"><table><caption class="sr-only">${escapeHtml(label || 'Chart')} plotted observations</caption><thead><tr><th scope="col">Observed at (UTC)</th><th scope="col">${escapeHtml(label || 'Value')}</th></tr></thead><tbody>${tableRows}</tbody></table></div></details>`;
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label || 'Dated line chart')}"><title>${escapeHtml(label || 'Dated line chart')}</title><desc>${points.length} sourced observations from ${escapeHtml(firstDate)} to ${escapeHtml(lastDate)}; missing daily dates are visibly broken and no values are filled.</desc>${grid}${area ? `<path d="${area}" fill="${color}" opacity=".06"/>` : ''}<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${circles}<text x="${margin.left}" y="${height - 8}" fill="#667a73" font-size="9">${escapeHtml(firstDate)}</text><text x="${width - margin.right}" y="${height - 8}" fill="#667a73" text-anchor="end" font-size="9">${escapeHtml(lastDate)}</text><text x="${width - margin.right}" y="${margin.top + 10}" fill="#49625a" text-anchor="end" font-size="9">${escapeHtml(yLabel || label || '')}</text></svg>${table}`;
  container.insertAdjacentHTML('beforeend', chartQueryDisclosure(container.id));
  const disclosure = container.querySelector('.chart-query');
  if (disclosure) disclosure.open = queryWasOpen;
}

function updateHeader() {
  const connected = DATA_SOURCES.filter((source) => source.connected);
  const statuses = connected.map((source) => state.sourceStatuses.get(source.id)).filter((status) => status && status.ok !== null);
  const successes = statuses.filter((status) => status.ok).length, failures = statuses.filter((status) => status.ok === false).length;
  const stale = statuses.filter((status) => status.ok && sourceIsStale(status)).length;
  const pending = connected.length - statuses.length;
  $('#scoreState').textContent = pending ? `${successes}/${connected.length} responding · checking` : `${successes}/${connected.length} sources responding`;
  $('#scoreState').style.color = failures ? 'var(--amber)' : 'var(--mint-strong)';
  const dot = $('#feedDot');
  if (pending > 0) {
    const parts = [];
    if (successes) parts.push(`${successes}/${connected.length} connected feeds responding`);
    if (failures) parts.push(`${failures} source checks failed`);
    parts.push(`${pending} checking`);
    $('#feedStatus').textContent = statuses.length ? parts.join(' · ') : 'Connecting to live sources';
    dot?.classList.remove('ok', 'bad');
  } else if (successes === connected.length && !failures && !stale) {
    $('#feedStatus').textContent = `All ${connected.length} connected feeds responding`;
    dot?.classList.add('ok'); dot?.classList.remove('bad');
  } else if (successes) {
    const warnings = failures + stale;
    $('#feedStatus').textContent = `${successes}/${connected.length} responded · ${warnings} stale/error warning${warnings === 1 ? '' : 's'}`;
    dot?.classList.remove('ok'); dot?.classList.add('bad');
  } else {
    $('#feedStatus').textContent = 'Latest source checks failed';
    dot?.classList.add('bad'); dot?.classList.remove('ok');
  }
  const times = statuses.filter((status) => status.ok).map((status) => Date.parse(status.checkedAt)).filter(Number.isFinite);
  if (times.length) {
    const latest = new Date(Math.max(...times)).toISOString();
    $('#sourceFreshness').textContent = `Most recent successful source check: ${ago(latest)} · ${utcDateTime(latest)}`;
    $('#footerFreshness').textContent = `Most recent successful source check: ${utcDateTime(latest)}`;
  }
}
function renderOverview() {
  const daily = allDailyRows(), marketFallback = !state.market && state.llamaPrice;
  const currentPrice = state.market?.priceUsd ?? state.llamaPrice?.priceUsd ?? null;
  $('#marketPrice').textContent = currentPrice === null ? 'Waiting for market feed' : usd(currentPrice, currentPrice < 1 ? 4 : 2);
  $('#marketPriceFoot').textContent = state.market?.timestamp ? `CoinGecko provider time: ${utcDateTime(state.market.timestamp)} · fetched ${ago(state.market.fetchedAt)}` : marketFallback ? `DefiLlama fallback price · provider time ${utcDateTime(state.llamaPrice.timestamp)}` : 'Waiting for a timestamped market snapshot';
  $('#marketChange').textContent = state.market?.priceChange24hPct === null || state.market?.priceChange24hPct === undefined ? 'Waiting for live 24-hour change' : formatSignedPercent(state.market.priceChange24hPct, 2);
  $('#marketChangeFoot').textContent = state.market?.timestamp ? `CoinGecko provider time: ${utcDateTime(state.market.timestamp)} · exchange-aggregated` : 'Awaiting a timestamped CoinGecko observation';
  $('#finalizedBlock').textContent = state.block ? compact(state.block.height, 0) : 'Waiting for finalized block';
  $('#finalizedBlockFoot').textContent = state.block ? `Finalized · block time ${utcDateTime(state.block.timestamp)} · fetched ${ago(state.block.fetchedAt)}` : 'Waiting for NEAR mainnet RPC';
  renderBlockAge();
  const chartRows = daily.slice(-(state.days + 1)), metric = state.chartMetric, meta = METRICS[metric] || METRICS.priceUsd;
  renderLineChart($('#overviewChart'), chartRows, metric, { label: meta.label, color: meta.color, format: meta.format, emptyText: 'No matched dated series yet. Current live spot data is shown above; the chart requires matching daily price and TVL dates.' });
  $('#observedSpan').textContent = chartRows.length > 1 ? `${chartRows.length} matched dates · ${chartRows[0].date} to ${chartRows.at(-1).date}` : 'Waiting for matched daily observations';
  $('#dataAsOf').textContent = `Daily series through ${daily.at(-1)?.date ?? '—'} UTC`;
  $('#overviewChartSubtitle').textContent = `${meta.label}; matched UTC dates only, current partial UTC day excluded.`;
  const tvl7d = windowChange(daily, 'tvlUsd', 7), tvl30d = windowChange(daily, 'tvlUsd', 30);
  const dims = [
    ['Finalized NEAR block', state.block ? `Block ${compact(state.block.height, 0)} observed` : 'Waiting for live block'],
    ['Verified block activity', state.blockActivity ? `${compact(state.blockActivity.transactionCount, 0)} transactions in one block` : 'Waiting for complete shard match'],
    ['Current validator snapshot', state.validators ? `${compact(state.validators.validatorCount, 0)} active-set records` : 'Waiting for live validator set'],
    ['Market and TVL context', state.market && state.tvlHistory ? 'Market snapshot and daily TVL loaded' : 'Checking connected market feeds'],
  ];
  $('#dimensionList').innerHTML = dims.map(([name, status]) => `<div class="dimension-row"><span>${escapeHtml(name)}</span><span class="dim-status">${escapeHtml(status)}</span></div>`).join('');
  const nodeSync = typeof state.rpcStatus?.syncing === 'boolean' ? (state.rpcStatus.syncing ? 'syncing' : 'not syncing') : 'not reported';
  const nodeHeight = state.rpcStatus?.sync_info?.latest_block_height ? ` · RPC node latest height ${compact(state.rpcStatus.sync_info.latest_block_height, 0)}` : '';
  const activityText = state.blockActivity ? ` Most recent sampled block ${compact(state.blockActivity.blockHeight, 0)} contains ${compact(state.blockActivity.transactionCount, 0)} transactions across ${state.blockActivity.shardCount ?? state.blockActivity.chunkCount} shards; ${state.blockActivity.chunkCount} newly included chunks were verified${state.blockActivity.reusedShardCount ? ` and ${state.blockActivity.reusedShardCount} prior-height reference${state.blockActivity.reusedShardCount === 1 ? '' : 's'} counted as zero` : ''}.` : ' Waiting for a complete per-block transaction sample.';
  $('#liveSummary').textContent = state.block ? `Finalized block ${compact(state.block.height, 0)} · ${state.block.activeChunks}/${state.block.chunkCount} chunks used gas · ${state.block.gasUtilizationPct?.toFixed(2) ?? '—'}% of reported chunk gas limits.${activityText} RPC node reports ${nodeSync}${nodeHeight}.` : `Waiting for live finalized block. RPC node reports ${nodeSync}${nodeHeight}.`;
  $('#contextSummary').textContent = daily.length ? `${daily.length} complete matched daily dates; current UTC date excluded. TVL change: 7-day ${tvl7d ? formatSignedPercent(tvl7d.changePct) : 'waiting for 8 consecutive dates'}, 30-day ${tvl30d ? formatSignedPercent(tvl30d.changePct) : 'waiting for 31 consecutive dates'}.` : 'Waiting for complete matched UTC-date history from market and TVL feeds.';
  $('#gapSummary').textContent = 'A block-local transaction count describes one sample, not a daily or unique-user adoption measure. Market volume and TVL are context signals, not directional net flows.';
}
function renderBlockAge() {
  if (!state.block) { $('#blockAge').textContent = 'Waiting'; $('#blockAgeFoot').textContent = 'Waiting for NEAR mainnet RPC'; return; }
  const age = Math.max(0, (Date.now() - state.block.timestampMs) / 1000);
  $('#blockAge').textContent = `${age.toFixed(1)} sec`;
  $('#blockAgeFoot').textContent = `Finalized block time ${utcDateTime(state.block.timestamp)} · last fetched ${ago(state.block.fetchedAt)}`;
}
function renderValueCapture() {
  const block = state.block;
  $('#valueStatus').textContent = block ? 'Live block estimate' : 'Waiting for finalized block';
  $('#valueStatus').className = `status-pill ${block ? 'good' : 'warn'}`;
  $('#blockGasCost').textContent = block ? `${block.estimatedGasFeeNear.toFixed(6)} Ⓝ` : 'Waiting for block';
  $('#blockGasUsed').textContent = block ? `${(block.gasUsed / 1e12).toFixed(2)} Tgas` : 'Waiting for block';
  $('#blockGasUsedFoot').textContent = block ? `${block.activeChunks}/${block.chunkCount} returned chunks have non-zero gas used` : 'Waiting for finalized chunk data';
  $('#blockGasUtil').textContent = block?.gasUtilizationPct === null || !block ? 'Waiting for block' : `${block.gasUtilizationPct.toFixed(2)}%`;
  $('#blockGasUtilFoot').textContent = block ? `Block ${compact(block.height, 0)} · ${utcDateTime(block.timestamp)}` : 'Waiting for finalized chunk data';
  $('#gasPrice').textContent = block ? `${block.gasPriceNearPerTgas.toFixed(6)} Ⓝ` : 'Waiting for block';
  $('#marketCap').textContent = state.market?.marketCapUsd === null || state.market?.marketCapUsd === undefined ? 'Waiting for market feed' : shortUsd(state.market.marketCapUsd);
  $('#grossVolume').textContent = state.market?.grossVolume24hUsd === null || state.market?.grossVolume24hUsd === undefined ? 'Waiting for market feed' : shortUsd(state.market.grossVolume24hUsd);
  const coinGeckoTime = Date.parse(state.market?.timestamp ?? ''), llamaTime = Date.parse(state.llamaPrice?.timestamp ?? '');
  const bothSpotPrices = Number.isFinite(state.market?.priceUsd) && state.market.priceUsd > 0 && Number.isFinite(state.llamaPrice?.priceUsd) && state.llamaPrice.priceUsd > 0;
  const timestampsValid = Number.isFinite(coinGeckoTime) && Number.isFinite(llamaTime);
  const timestampGapMs = timestampsValid ? Math.abs(coinGeckoTime - llamaTime) : null;
  const spotGap = bothSpotPrices && timestampsValid && timestampGapMs <= 300_000 ? Math.abs(state.market.priceUsd - state.llamaPrice.priceUsd) / state.market.priceUsd * 100 : null;
  $('#spotDifference').textContent = spotGap === null ? (bothSpotPrices && timestampsValid ? 'Not time-matched' : 'Waiting for two spot feeds') : `${spotGap.toFixed(2)}%`;
  $('#marketCapTime').textContent = state.market?.timestamp ? `CoinGecko ${utcDateTime(state.market.timestamp)}` : 'Waiting for provider timestamp';
  $('#grossVolumeTime').textContent = state.market?.timestamp ? `CoinGecko ${utcDateTime(state.market.timestamp)}` : 'Waiting for provider timestamp';
  $('#spotDifferenceFoot').textContent = timestampsValid ? timestampGapMs <= 300_000 ? `CoinGecko ${utcDateTime(state.market.timestamp)} · DefiLlama ${utcDateTime(state.llamaPrice.timestamp)}` : `Not compared: provider timestamps differ by ${(timestampGapMs / 60_000).toFixed(1)} minutes` : 'Waiting for both timestamped spot feeds';
  renderFeeEstimate();
  const observations = state.observations.map((row) => ({ ...row, gasTgas: Number(row.gasUsed) / 1e12 }));
  renderLineChart($('#gasChart'), observations, 'gasTgas', { label: 'Gas used per sampled finalized block', color: '#197e78', format: 'tgas', dateKey: 'observedAt', emptyText: 'Collecting real finalized-block observations. No historical values are fabricated.' });
  $('#blockHistoryStatus').textContent = observations.length ? `${observations.length} live block sample${observations.length === 1 ? '' : 's'}` : 'Collecting observations';
  $('#blockHistorySpan').textContent = observations.length > 1 ? `${utcDateTime(observations[0].observedAt)} to ${utcDateTime(observations.at(-1).observedAt)}` : 'A local time series appears after multiple polls.';
}
function renderParticipation() {
  const validators = state.validators;
  const validatorStatus = state.sourceStatuses.get('near-rpc-validators');
  const validatorPlaceholder = validatorStatus?.ok === false ? 'Retrying live feed' : 'Waiting for live feed';
  $('#validatorCount').textContent = validators ? compact(validators.validatorCount, 0) : validatorPlaceholder;
  $('#validatorEpoch').textContent = validators?.epochHeight === null || validators?.epochHeight === undefined ? validatorStatus?.ok === false ? 'Retrying current epoch read' : 'Waiting for current epoch' : `Epoch height ${compact(validators.epochHeight, 0)} · ${validators.nextValidatorCount ?? '—'} next-set records`;
  $('#validatorTop10').textContent = validators ? `${validators.top10SharePct.toFixed(1)}%` : validatorPlaceholder;
  $('#validatorHhi').textContent = validators ? `Current-set stake HHI: ${validators.hhi.toFixed(0)}` : `${validatorPlaceholder} · no concentration estimate`;
  $('#validatorProduction').textContent = validators?.blockProductionPct === null || !validators ? validatorPlaceholder : `${validators.blockProductionPct.toFixed(1)}%`;
  $('#validatorProductionFoot').textContent = validators ? `${compact(validators.producedBlocks, 0)} produced / ${compact(validators.expectedBlocks, 0)} expected blocks in returned epoch counters` : validatorStatus?.ok === false ? 'Retrying current epoch counters' : 'Waiting for current epoch counters';
  const activity = state.blockActivity;
  const sourceStatus = state.sourceStatuses.get('fastnear-neardata-block-transactions');
  const activityPlaceholder = sourceStatus?.ok === false ? 'Retrying sample' : 'Waiting for sample';
  $('#blockTxLatest').textContent = activity ? compact(activity.transactionCount, 0) : activityPlaceholder;
  $('#blockTxAsOf').textContent = activity ? `Finalized block ${compact(activity.blockHeight, 0)} · ${activity.chunkCount} new chunks / ${activity.shardCount ?? activity.chunkCount} shards${activity.reusedShardCount ? ` · ${activity.reusedShardCount} prior-height reference${activity.reusedShardCount === 1 ? '' : 's'} counted as zero` : ''} · ${utcDateTime(activity.blockTimestamp)}` : sourceStatus?.ok === false ? 'Retrying for a complete all-shard count' : 'Waiting for complete all-shard count';
  $('#blockTxChunks').textContent = activity ? compact(activity.chunkCount, 0) : activityPlaceholder;
  $('#blockTxFreshness').textContent = activity?.fetchedAt ? `Sampled ${ago(activity.fetchedAt)} · current-height chunk matches, prior-height references and transaction hashes are retained for offline replay; full transaction bodies and receipts are discarded.` : sourceStatus?.ok === false ? 'Latest read failed; retrying for a complete finalized-block sample.' : 'Requesting a complete finalized-block sample.';
  $('#activityStatus').textContent = activity ? (sourceStatus?.ok === false ? 'Last sample retained · retrying' : 'Live block count observed') : (sourceStatus?.ok === false ? 'Retrying complete chunk sample' : 'Sampling finalized chunks');
  $('#activityStatus').className = `status-pill ${activity && sourceStatus?.ok !== false ? 'good' : 'warn'}`;
  const observations = state.observations;
  renderLineChart($('#blockTxChart'), observations, 'transactionCount', { label: 'Transactions per sampled finalized block', color: '#7f61a6', format: 'count', dateKey: 'observedAt', emptyText: 'Waiting for at least two complete live samples. No historical transaction values are fabricated.' });
  const samples = observations.filter((row) => Number.isSafeInteger(row.transactionCount));
  $('#blockTxHistoryStatus').textContent = `${samples.length} complete local samples`;
  $('#blockTxHistorySpan').textContent = samples.length > 1 ? `${utcDateTime(samples[0].transactionFetchedAt)} to ${utcDateTime(samples.at(-1).transactionFetchedAt)}` : 'A local sample history appears after more five-minute polls.';
}
function riskPillClass(tone) { return tone === 'high' ? 'bad' : tone === 'positive' ? 'good' : tone === 'caution' ? 'warn' : ''; }
function renderRiskSources(risk) {
  return (RISK_SOURCE_IDS[risk.id] || []).map((sourceId) => {
    const source = DATA_SOURCES.find((item) => item.id === sourceId);
    if (!source) return '';
    const status = state.sourceStatuses.get(sourceId);
    let label = 'Checking first live read';
    if (status?.ok && sourceIsStale(status)) label = 'Observation is stale';
    else if (status?.ok) label = 'Responding';
    else if (status?.ok === false && dataAvailableFor(sourceId)) label = 'Latest read failed; prior observation retained';
    else if (status?.ok === false) label = 'Not responding';
    const providerAt = status?.providerAt ?? status?.lastProviderAt;
    const freshnessTime = providerAt ?? status?.checkedAt;
    const freshness = freshnessTime ? ` · ${providerAt ? 'provider ' : 'checked '}${utcDateTime(freshnessTime)}` : '';
    return `<span class="risk-source-item"><a href="${escapeHtml(source.docUrl || source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a> <small>${escapeHtml(label + freshness)}</small></span>`;
  }).filter(Boolean).join(' · ');
}
function renderRisks() {
  const daily = allDailyRows(), tvl7d = windowChange(daily, 'tvlUsd', 7), tvl30d = windowChange(daily, 'tvlUsd', 30);
  const market = state.market ? { priceChange24h: state.market.priceChange24hPct, priceUsd: state.market.priceUsd, timestamp: state.market.timestamp } : null;
  const rpcStatus = state.rpcStatus?.chain_id === 'mainnet' ? state.rpcStatus : null;
  const block = state.block ? { ...state.block, ageSeconds: (Date.now() - state.block.timestampMs) / 1000 } : null;
  const risks = assessLiveRisks({ market, tvl7d, tvl30d, validators: state.validators, block, rpcStatus, blockActivity: state.blockActivity, declineThreshold: state.declineThreshold });
  const filter = $('#riskFilter')?.value || 'all';
  const visibleRisks = risks.filter((risk) => filter === 'all' || risk.tone === 'high' || (risk.id === 'infrastructure' && risk.tone === 'caution'));
  const alerts = risks.filter((risk) => risk.tone === 'high' || (risk.id === 'infrastructure' && risk.tone === 'caution')).length;
  $('#riskFilterStatus').textContent = `${visibleRisks.length} live signals · ${alerts} active watch${alerts === 1 ? '' : 'es'} · decline threshold ${state.declineThreshold}%`;
  $('#riskGrid').innerHTML = visibleRisks.map((risk) => {
    const sourceLinks = renderRiskSources(risk);
    return `<article class="card risk-card"><div class="risk-top"><h3>${escapeHtml(risk.title)}</h3><span class="status-pill ${riskPillClass(risk.tone)}">${escapeHtml(risk.state)}</span></div><p><strong>Severity:</strong> ${escapeHtml(risk.severity)}</p><p><strong>Trend:</strong> ${escapeHtml(risk.trend)}</p><p><strong>Evidence:</strong> ${escapeHtml(risk.evidence)}</p><p class="risk-source"><strong>Sources:</strong> ${sourceLinks || 'No source attribution available'}</p><p><strong>Confidence:</strong> ${escapeHtml(risk.confidence)}</p><p class="risk-impact"><strong>Potential impact:</strong> ${escapeHtml(risk.impact)}</p><p class="risk-next"><strong>Next check:</strong> ${escapeHtml(risk.next)}</p></article>`;
  }).join('');
  if (!visibleRisks.length) $('#riskGrid').innerHTML = risks.length ? '<div class="empty-state">No monitored signal crosses this threshold. A no-alert result is not proof that no risk exists.</div>' : '<div class="empty-state">Live risk cards appear when their source observations are loaded. No risk is inferred from missing data.</div>';
  $('#riskThresholdOutput').value = `${state.declineThreshold}%`;
  $('#riskThresholdOutput').textContent = `${state.declineThreshold}%`;
}
function renderCapital() {
  const daily = allDailyRows(), latest = daily.at(-1);
  const change7 = windowChange(daily, 'tvlUsd', 7), change30 = windowChange(daily, 'tvlUsd', 30);
  $('#latestTvl').textContent = latest ? shortUsd(latest.tvlUsd) : 'Waiting for daily observation';
  $('#tvlAsOf').textContent = latest ? `DefiLlama daily snapshot · ${latest.date} UTC` : 'Waiting for a matched source date';
  $('#tvlChange7d').textContent = change7 ? formatSignedPercent(change7.changePct) : 'Waiting for a complete window';
  $('#tvlSpan7d').textContent = change7 ? `${change7.startDate} to ${change7.endDate} · USD TVL stock` : 'Requires 8 consecutive matched daily dates';
  $('#tvlChange30d').textContent = change30 ? formatSignedPercent(change30.changePct) : 'Waiting for a complete window';
  $('#tvlSpan30d').textContent = change30 ? `${change30.startDate} to ${change30.endDate} · USD TVL stock` : 'Requires 31 consecutive matched daily dates';
  const chartDays = Number($('#capitalWindowSelect')?.value || 30), capitalRows = daily.slice(-(chartDays + 1));
  renderLineChart($('#capitalChart'), capitalRows, 'tvlUsd', { label: 'NEAR DeFi total value locked, daily USD snapshot', color: '#197e78', format: 'usd', emptyText: 'Waiting for aligned daily NEAR DeFi TVL and market dates.' });
  $('#tvlDateSpan').textContent = capitalRows.length ? `${capitalRows.length} complete matched dates · ${capitalRows[0].date} to ${capitalRows.at(-1).date}` : 'No aligned daily series';
  $('#capitalFreshness').textContent = state.tvlHistory?.fetchedAt ? `Fetched ${ago(state.tvlHistory.fetchedAt)}` : 'Source not yet fetched';
  $('#capitalStatus').textContent = latest ? 'Matched daily TVL' : 'Checking daily TVL';
  $('#capitalStatus').className = `status-pill ${latest ? 'good' : 'warn'}`;
  $('#capitalLastChecked').textContent = state.tvlHistory?.fetchedAt ? `TVL source fetched ${utcDateTime(state.tvlHistory.fetchedAt)}; dates are matched to CoinGecko market history.` : 'Waiting for live TVL snapshots.';
}
function renderHypothesis() {
  renderThesisProvenance();
  const daily = hypothesisRows(), metricA = $('#metricA')?.value || 'priceUsd', metricB = $('#metricB')?.value || 'tvlUsd';
  const direction = $('#hypothesisDirection')?.value || 'positive', days = Number($('#hypothesisDays')?.value || 14);
  if (metricA === metricB) { $('#hypothesisVerdict').textContent = 'Choose distinct series'; $('#hypothesisSummary').textContent = 'Comparing a series with itself always gives a trivial relationship. Select two different sourced series.'; $('#hypothesisDetails').innerHTML = '<li>No test result has been inferred.</li>'; return; }
  const result = testHypothesis(daily, metricA, metricB, direction, days), title = $('#hypothesisLabel')?.value?.trim() || 'Untitled hypothesis';
  const verdict = $('#hypothesisVerdict');
  verdict.textContent = result.verdict;
  verdict.className = `result-verdict ${result.verdict === 'Not supported' ? 'negative' : ['Partially supported', 'Insufficient evidence'].includes(result.verdict) ? 'partial' : ''}`;
  const rText = result.r === null ? 'Correlation not calculated' : `Pearson r = ${result.r.toFixed(2)}`;
  $('#hypothesisSummary').textContent = `${title}. The selected test asks whether daily changes in ${METRICS[metricA]?.label.toLowerCase()} and ${METRICS[metricB]?.label.toLowerCase()} show ${titleCaseDirection(direction)} across ${days} matched daily changes. ${rText}.`;
  const details = [`${result.n} matched daily changes${result.startDate && result.endDate ? ` · ${result.startDate} to ${result.endDate}` : ''}.`];
  if (result.r === null && result.n < days) details.push(`Correlation withheld: the selected test requires exactly ${days} consecutive matched daily changes; ${result.n} were available.`);
  else if (result.r === null) details.push('Correlation is undefined because at least one selected series has no variation in the complete window.');
  else if (result.verdict === 'Supported by available evidence') details.push('Observed co-movement matches the declared direction under the visible |r| ≥ 0.30 product rule.');
  else if (result.verdict === 'Not supported') details.push('Observed co-movement is strong in the direction opposite the selected hypothesis under the visible |r| ≥ 0.30 product rule.');
  else details.push('The selected series do not cross the product-rule threshold in either direction; this does not prove independence.');
  details.push('No p-value, causal attribution or forecast is calculated. Daily observations can be autocorrelated; address counts are not verified people or retention, and market/TVL values are not independent evidence of user adoption.');
  $('#hypothesisDetails').innerHTML = details.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}
function renderThesisProvenance() {
  const sourceIds = ['coingecko-history', 'defillama-tvl'];
  const observations = sourceIds.map((sourceId) => {
    const source = DATA_SOURCES.find((item) => item.id === sourceId);
    const status = state.sourceStatuses.get(sourceId);
    const fetchedAt = sourceId === 'coingecko-history' ? state.marketChart?.fetchedAt : state.tvlHistory?.fetchedAt;
    const providerAt = status?.providerAt ?? status?.lastProviderAt;
    const stateText = status?.ok === true ? sourceIsStale(status) ? 'responding; last provider observation is stale' : 'responding' : status?.ok === false ? dataAvailableFor(sourceId) ? 'latest request failed; previous data retained' : 'no successful response yet' : 'checking';
    return `${source?.name ?? sourceId}: ${stateText}${providerAt ? ` · provider time ${utcDateTime(providerAt)}` : ''}${fetchedAt ? ` · fetched ${utcDateTime(fetchedAt)}` : ''}`;
  });
  $('#thesisSourceStatus').innerHTML = observations.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  $('#thesisPlainLanguage').textContent = THESIS_TEST_RECIPE.plainLanguage;
  $('#thesisSourceQuery').textContent = THESIS_TEST_RECIPE.query;
  $('#thesisMethodList').innerHTML = THESIS_TEST_RECIPE.method.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  $('#thesisLimitations').innerHTML = THESIS_TEST_RECIPE.limitations.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}
function dataAvailableFor(sourceId) {
  return ({ 'near-rpc-finalized': Boolean(state.block), 'fastnear-neardata-block-transactions': Boolean(state.blockActivity), 'near-rpc-status': Boolean(state.rpcStatus), 'near-rpc-validators': Boolean(state.validators), 'coingecko-market': Boolean(state.market), 'coingecko-history': Boolean(state.marketChart), 'defillama-price': Boolean(state.llamaPrice), 'defillama-tvl': Boolean(state.tvlHistory?.rows?.length) })[sourceId] ?? false;
}
function renderAll() {
  const renderers = {
    overview: renderOverview,
    'value-capture': renderValueCapture,
    adoption: renderParticipation,
    'risk-radar': renderRisks,
    'capital-flows': renderCapital,
    'thesis-challenge': renderHypothesis,
  };
  (renderers[resolveWorkspace(location.hash)] || renderOverview)();
  updateHeader();
}
async function fetchAndApply(field, fetcher) {
  if (state.inFlight.has(field)) return null;
  const scheduledRetry = state.retryAt.get(field);
  if (scheduledRetry && scheduledRetry > Date.now()) return null;
  state.inFlight.add(field);
  try {
    let result;
    try { result = await fetcher(); }
    catch (error) {
      const sourceId = FIELD_SOURCE_IDS[field], previous = state.sourceStatuses.get(sourceId);
      result = { status: { sourceId, ok: false, checkedAt: new Date().toISOString(), providerAt: null, latencyMs: null, detail: error?.message || 'Unexpected source error' } };
      if (previous?.providerAt || previous?.lastProviderAt) result.status.lastProviderAt = previous.providerAt ?? previous.lastProviderAt;
    }
    const status = result?.status;
    if (status?.ok === false) {
      const previous = state.sourceStatuses.get(status.sourceId);
      status.lastProviderAt ??= previous?.providerAt ?? previous?.lastProviderAt ?? null;
      const failures = (state.failureCounts.get(field) || 0) + 1;
      state.failureCounts.set(field, failures);
      const baseDelay = field === 'block' ? 30_000 : 60_000;
      const delay = Math.min(30 * 60_000, baseDelay * 2 ** Math.min(failures - 1, 5));
      const retryAt = Date.now() + delay;
      state.retryAt.set(field, retryAt);
      status.retryAt = new Date(retryAt).toISOString();
    } else if (status?.ok) {
      state.failureCounts.delete(field);
      state.retryAt.delete(field);
    }
    applyResult(field, result);
    return result;
  } finally { state.inFlight.delete(field); }
}
async function refreshBlock() {
  if (state.rpcBusy) return null;
  state.rpcBusy = true;
  try {
    const result = await fetchAndApply('block', fetchFinalizedBlock);
    const block = result?.value ?? state.block;
    if (block) appendBlockObservation(block);
    const blockIsRecent = Number.isFinite(block?.timestampMs) && Date.now() - block.timestampMs <= 30_000;
    const sampleIsDue = Date.now() - state.lastChunkRequestAt >= BLOCK_TRANSACTION_INTERVAL_MS;
    if (block && blockIsRecent && sampleIsDue && state.blockActivity?.blockHeight !== block.height) {
      state.lastChunkRequestAt = Date.now();
      const activityResult = await fetchAndApply('blockActivity', () => fetchNeardataBlockTransactionCount(block));
      const activity = activityResult?.value;
      if (activity && activity.blockHeight === block.height) appendBlockObservation({ ...block, transactionCount: activity.transactionCount, transactionChunkCount: activity.chunkCount, transactionFetchedAt: activity.fetchedAt, rawChunks: activity.rawChunks });
    }
    return result;
  }
  finally { state.rpcBusy = false; renderAll(); }
}
async function refreshSlowRpc() {
  if (state.rpcBusy) return null;
  state.rpcBusy = true;
  try { await fetchAndApply('rpcStatus', fetchRpcStatus); await fetchAndApply('validators', fetchValidatorSet); }
  finally { state.rpcBusy = false; renderAll(); }
}
async function refreshDefiPrice() { const result = await fetchAndApply('llamaPrice', fetchDefiLlamaPrice); renderAll(); return result; }
async function refreshTvl() { const result = await fetchAndApply('tvlHistory', fetchTvlHistory); renderAll(); return result; }
async function refreshCoinGecko() {
  if (Date.now() - state.lastMarketRefresh < MARKET_MANUAL_COOLDOWN_MS) {
    $('#marketPriceFoot').textContent = `Market snapshot refresh is limited to once per minute; last snapshot ${state.market?.timestamp ? utcDateTime(state.market.timestamp) : 'not available'}.`;
    return false;
  }
  state.lastMarketRefresh = Date.now();
  const [marketResult, historyResult] = await Promise.all([
    fetchAndApply('market', fetchCoinGeckoMarket), fetchAndApply('marketChart', fetchCoinGeckoHistory),
  ]);
  renderAll();
  return Boolean(marketResult?.status?.ok && historyResult?.status?.ok);
}
async function initialLoad() {
  $('#refreshButton').disabled = true;
  try {
    state.lastMarketRefresh = Date.now();
    await Promise.all([
      refreshBlock(), fetchAndApply('llamaPrice', fetchDefiLlamaPrice),
      fetchAndApply('tvlHistory', fetchTvlHistory), fetchAndApply('market', fetchCoinGeckoMarket),
      fetchAndApply('marketChart', fetchCoinGeckoHistory),
    ]);
    renderAll();
    await refreshSlowRpc();
  } finally { $('#refreshButton').disabled = false; renderAll(); }
}
async function refreshEverything() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  const button = $('#refreshButton'); button.disabled = true; button.innerHTML = '↻ <span>Refreshing…</span>';
  try {
    await refreshBlock();
    await Promise.all([refreshDefiPrice(), refreshTvl()]);
    await refreshSlowRpc();
    if (Date.now() - state.lastMarketRefresh >= MARKET_MANUAL_COOLDOWN_MS) await refreshCoinGecko();
    else $('#marketPriceFoot').textContent = `CoinGecko manual refresh cooldown; current snapshot from ${state.market?.timestamp ? utcDateTime(state.market.timestamp) : 'unavailable'}.`;
  } finally { state.isRefreshing = false; button.disabled = false; button.innerHTML = '↻ <span>Refresh</span>'; renderAll(); announce('Available signals refreshed. Transaction samples respect a five-minute cadence and CoinGecko a one-minute cooldown. See source status for failed reads.'); }
}
function exportEvidence() {
  const bundle = {
    project: 'NEAR SIGNAL', exportedAt: new Date().toISOString(), status: 'public read-only Vercel dashboard; hackathon submission not made',
    live: { market: state.market, independentSpotPrice: state.llamaPrice, finalizedBlock: state.block, sampledFinalizedBlockTransactions: state.blockActivity,
      rpcStatus: state.rpcStatus ? { chainId: state.rpcStatus.chain_id, syncing: state.rpcStatus.syncing, latestBlockHeight: state.rpcStatus.sync_info?.latest_block_height, latestBlockTime: state.rpcStatus.sync_info?.latest_block_time } : null,
      currentValidatorSet: state.validators },
    dailyAlignedMarketAndTvl: allDailyRows(), dailyHypothesisSeries: hypothesisRows(), rawTvlRows: state.tvlHistory?.rows ?? null, rawCoinGeckoMarketChart: state.marketChart,
    localRpcObservationHistory: state.observations,
    chartSelections: { days: state.days, metric: state.chartMetric, capitalDays: Number($('#capitalWindowSelect').value) },
    onDemandAccountInspection: accountInspection,
    executionCostScenario: { gasTgas: Number($('#feeGasInput').value), gasPriceNearPerTgas: state.block?.gasPriceNearPerTgas ?? null, priceUsd: state.market?.priceUsd ?? state.llamaPrice?.priceUsd ?? null, estimate: estimateExecutionCost($('#feeGasInput').value, state.block?.gasPriceNearPerTgas, state.market?.priceUsd ?? state.llamaPrice?.priceUsd) },
    chartQueryRecipes: CHART_QUERY_RECIPES,
    thesisTestRecipe: THESIS_TEST_RECIPE,
    unexecutedBigQuery: { dataset: BIGQUERY_DATASET, inspectedTables: BIGQUERY_INSPECTED_TABLES, inspectedQueryFields: BIGQUERY_INSPECTED_FIELDS, sql: BIGQUERY_ACTIVITY_QUERY, status: 'Not connected; no query was submitted.' },
    sourceRegistry: DATA_SOURCES.map((source) => ({ ...source, status: state.sourceStatuses.get(source.id) ?? null })),
    limitations: ['The sampled transaction count is for one finalized block and is not a daily series, unique-user count, retention measure or adoption trend.', 'Daily account cohorts, historical transaction counts and contract activity are not included; no BigQuery query was run.', 'BigQuery schemas were inspected, but no application credentials, cost-approved query or data result is connected.', 'No Intents Explorer JWT is configured and no canonical, deduplicated Intents or bridge net-flow history is connected.', 'Market volume is gross exchange activity; TVL is a USD stock; neither is net investment.', 'The hypothesis calculation is descriptive correlation only; it does not establish causation or statistical significance.', 'Local RPC observation history only accrues while this browser is open and is not a chain archive.'],
  };
  bundle.replayedChartInputs = replayChartInputs(bundle);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `near-signal-evidence-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
}

function announce(message) { $('#workspaceNotice').textContent = message; }
function downloadFile(filename, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setMenuOpen(open) {
  document.body.classList.toggle('menu-open', open);
  $('#menuToggle').setAttribute('aria-expanded', String(open));
  $('#menuToggle').setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  $('#sidebarBackdrop').hidden = !open;
  const mobile = window.matchMedia('(max-width: 899px)').matches;
  $('#sidebar').inert = mobile && !open;
  $('.workspace').inert = mobile && open;
}
function navigateWorkspace(focus = false) {
  const route = resolveWorkspace(location.hash), meta = WORKSPACES[route];
  document.querySelectorAll('main > section.block[id]').forEach((section) => { section.hidden = section.id !== route; });
  document.querySelectorAll('.nav a').forEach((link) => {
    const active = link.hash === `#${route}`; link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('#workspaceTitle').textContent = meta.title; $('#workspaceSubtitle').textContent = meta.description;
  document.title = `${meta.title} | NEAR SIGNAL`;
  document.body.dataset.route = route; setMenuOpen(false);
  if (focus) { const section = document.getElementById(route); section.setAttribute('tabindex', '-1'); section.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  renderAll();
}
function renderFeeEstimate() {
  const result = estimateExecutionCost($('#feeGasInput')?.value, state.block?.gasPriceNearPerTgas, state.market?.priceUsd ?? state.llamaPrice?.priceUsd);
  $('#feeEstimateNear').textContent = result ? `${result.near.toFixed(6)} Ⓝ` : 'Waiting for live gas price';
  $('#feeEstimateUsd').textContent = result?.usd !== null && result?.usd !== undefined ? usd(result.usd, 6) : 'Waiting for timestamped market price';
  $('#feeEstimateSource').textContent = state.block ? `Block ${state.block.height} · ${utcDateTime(state.block.timestamp)} · ${state.block.gasPriceNearPerTgas.toFixed(6)} Ⓝ/Tgas` : 'Waiting for live gas price';
  $('#feeCalculatorStatus').textContent = result ? 'Live gas price' : state.block ? 'Check gas budget' : 'Needs live gas price';
  $('#feeCalculatorFeedback').textContent = result ? `${result.gasTgas} Tgas × latest block gas price. USD equivalent uses a separately timestamped market price; storage and other charges are excluded.` : 'Enter a budget above 0 and no greater than 300 Tgas. A live gas price is required.';
}
function generateSql() {
  try {
    generatedSql = buildActivitySql({ startDate: $('#sqlStartDate').value, endDate: $('#sqlEndDate').value, contractId: $('#sqlContractId').value.trim() });
    $('#generatedSqlCode').textContent = generatedSql;
    $('#sqlBuilderFeedback').textContent = 'SQL generated locally. Every scanned table is block_date-filtered. Nothing has been executed; review estimated bytes and obtain approval before running.';
    return true;
  } catch (error) { generatedSql = ''; $('#generatedSqlCode').textContent = ''; $('#sqlBuilderFeedback').textContent = error.message; return false; }
}
async function inspectAccount(event) {
  event.preventDefault();
  const accountId = $('#accountIdInput').value.trim();
  if (!isNearAccountId(accountId)) { $('#accountInspectorResult').textContent = 'Enter a valid lowercase NEAR account ID (2–64 characters).'; return; }
  if (Date.now() - lastAccountRequestAt < 5000) { $('#accountInspectorStatus').textContent = 'Wait 5 seconds between reads'; return; }
  lastAccountRequestAt = Date.now();
  const button = $('#inspectAccountButton'); button.disabled = true; $('#accountInspectorStatus').textContent = 'Reading mainnet';
  try {
    const response = await fetchAccountSnapshot(accountId);
    if (!response.value) { accountInspection = null; $('#accountInspectorStatus').textContent = 'Read failed'; $('#accountInspectorResult').textContent = `${response.status?.detail || 'Account lookup failed.'} No account value is inferred.`; return; }
    accountInspection = response.value; const account = accountInspection;
    $('#accountInspectorStatus').textContent = 'Finalized account state';
    $('#accountInspectorResult').innerHTML = `<div style="width:100%"><div class="metric-row"><div class="metric-mini"><span>Account balance · NEAR</span><b>${escapeHtml(compact(account.balanceNear, 4))}</b><small>Includes storage backing; not a spendable-balance quote</small></div><div class="metric-mini"><span>Locked stake · NEAR</span><b>${escapeHtml(compact(account.lockedNear, 4))}</b><small>Account locked amount from RPC</small></div><div class="metric-mini"><span>Deployed contract</span><b>${account.hasContract ? 'Yes' : 'No code'}</b><small>${escapeHtml(compact(account.storageBytes, 0))} bytes storage used</small></div></div><p class="timestamp">${escapeHtml(account.accountId)} · finalized block ${account.blockHeight} · fetched ${escapeHtml(utcDateTime(account.fetchedAt))}</p><details class="chart-query"><summary>View account source request and raw response</summary><div class="query-content"><pre><code>${escapeHtml(JSON.stringify({ endpoint: 'https://free.rpc.fastnear.com', request: account.request, response: account.raw }, null, 2))}</code></pre></div></details></div>`;
  } finally { button.disabled = false; }
}
function exportHypothesis() {
  const metricA = $('#metricA').value, metricB = $('#metricB').value;
  if (metricA === metricB) { announce('Choose distinct series before exporting a test.'); return; }
  const result = testHypothesis(hypothesisRows(), metricA, metricB, $('#hypothesisDirection').value, Number($('#hypothesisDays').value));
  const sourceIds = ['coingecko-history', 'defillama-tvl'];
  const sourceObservations = Object.fromEntries(sourceIds.map((sourceId) => {
    const status = state.sourceStatuses.get(sourceId);
    return [sourceId, { fetchedAt: sourceId === 'coingecko-history' ? state.marketChart?.fetchedAt ?? null : state.tvlHistory?.fetchedAt ?? null, providerAt: status?.providerAt ?? status?.lastProviderAt ?? null }];
  }));
  const bundle = createThesisTestEvidence({
    hypothesis: $('#hypothesisLabel').value,
    metricA,
    metricB,
    direction: $('#hypothesisDirection').value,
    days: Number($('#hypothesisDays').value),
    result,
    dailyInputs: hypothesisRows(),
    rawCoinGeckoMarketChart: state.marketChart ?? null,
    rawTvlRows: state.tvlHistory?.rows ?? null,
    sourceObservations,
    sources: DATA_SOURCES.filter((source) => sourceIds.includes(source.id)),
    sourceStatuses: sourceIds.map((sourceId) => state.sourceStatuses.get(sourceId) ?? { sourceId, ok: null, checkedAt: null, providerAt: null, detail: 'No completed source check is available.' }),
  });
  downloadFile('near-signal-thesis-test.json', JSON.stringify(bundle, null, 2), 'application/json'); announce('Test result and sourced inputs exported.');
}
function setupWorkspaceControls() {
  $('#menuToggle').textContent = '';
  $('#menuToggle').addEventListener('click', () => { const open = !document.body.classList.contains('menu-open'); setMenuOpen(open); if (open) $('.nav a').focus(); });
  $('#sidebarBackdrop').addEventListener('click', () => { setMenuOpen(false); $('#menuToggle').focus(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('menu-open')) { setMenuOpen(false); $('#menuToggle').focus(); } });
  window.addEventListener('resize', () => setMenuOpen(document.body.classList.contains('menu-open')));
  window.addEventListener('hashchange', () => navigateWorkspace(true));
  $('.nav').addEventListener('click', (event) => { if (event.target.closest('a')) setMenuOpen(false); });
  $('#feeCalculatorForm').addEventListener('submit', (event) => { event.preventDefault(); renderFeeEstimate(); });
  $('#feeGasInput').addEventListener('input', renderFeeEstimate);
  $('#accountInspectorForm').addEventListener('submit', inspectAccount);
  $('#sqlBuilderForm').addEventListener('submit', (event) => { event.preventDefault(); generateSql(); });
  $('#downloadSqlButton').addEventListener('click', () => { if (generateSql()) { downloadFile('near-signal-activity.sql', generatedSql, 'application/sql'); announce('SQL downloaded. No BigQuery job has been submitted.'); } });
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 1); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
  $('#sqlEndDate').value = end.toISOString().slice(0, 10); $('#sqlStartDate').value = start.toISOString().slice(0, 10); generateSql();
  $('#capitalWindowSelect').addEventListener('change', renderCapital);
  $('#riskFilter').addEventListener('change', renderRisks);
  $('#exportHypothesisButton').addEventListener('click', exportHypothesis);
  document.addEventListener('click', async (event) => {
    const queryButton = event.target.closest('[data-copy-query]');
    if (queryButton) { const text = CHART_QUERY_RECIPES[queryButton.dataset.copyQuery]?.query; if (!text) return; try { await navigator.clipboard.writeText(text); announce('Source query copied.'); } catch { downloadFile('near-signal-source-query.txt', text); announce('Clipboard unavailable; source query downloaded instead.'); } }
    const chartButton = event.target.closest('[data-download-chart]');
    if (chartButton) { const data = chartExportData.get(chartButton.dataset.downloadChart); if (!data?.points.length) { announce('No sourced chart observations are available to export.'); return; } downloadFile(`near-signal-${chartButton.dataset.downloadChart}.csv`, toCsv(data.points, data.label || data.metric), 'text/csv'); announce(`${data.points.length} plotted observations exported to CSV.`); }
  });
  navigateWorkspace();
}

function setupInteractions() {
  $('#windowSelect').addEventListener('change', (event) => { state.days = Number(event.target.value) || 14; renderAll(); });
  $('#riskThreshold').addEventListener('input', (event) => { state.declineThreshold = Number(event.target.value) || 20; $('#riskThresholdOutput').value = `${state.declineThreshold}%`; $('#riskThresholdOutput').textContent = `${state.declineThreshold}%`; $('#riskThresholdStatus').textContent = `Risk states recalculated with a ${state.declineThreshold} percent decline threshold.`; renderRisks(); });
  document.querySelectorAll('[data-chart-metric]').forEach((button) => button.addEventListener('click', () => {
    state.chartMetric = button.dataset.chartMetric;
    document.querySelectorAll('[data-chart-metric]').forEach((node) => node.setAttribute('aria-pressed', String(node === button)));
    renderOverview();
  }));
  $('#hypothesisLabel').addEventListener('input', renderHypothesis);
  ['metricA', 'metricB', 'hypothesisDirection', 'hypothesisDays'].forEach((id) => $(`#${id}`).addEventListener('change', renderHypothesis));
  $('#runHypothesisButton').addEventListener('click', renderHypothesis);
  $('#refreshButton').addEventListener('click', refreshEverything);
  $('#exportButton').addEventListener('click', exportEvidence);
  setupWorkspaceControls();
}

setupInteractions();
renderAll();
void initialLoad();
setInterval(() => { void refreshBlock(); }, FAST_INTERVAL_MS);
setInterval(() => { void refreshDefiPrice(); }, DEFI_PRICE_INTERVAL_MS);
setInterval(() => { void refreshSlowRpc(); }, SLOW_RPC_INTERVAL_MS);
setInterval(() => { void refreshTvl(); }, TVL_INTERVAL_MS);
setInterval(() => { if (document.body.dataset.route === 'overview') renderBlockAge(); }, 1000);
setInterval(() => { if (document.body.dataset.route === 'risk-radar') renderRisks(); }, 10_000);
