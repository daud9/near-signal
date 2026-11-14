import { alignMarketAndTvl, assessLiveRisks, completeWindowSum, completeWindowSumChange, formatSignedPercent, summarizeBlock, summarizeBlockTransactions, summarizeIndexedProtocolConcentration, summarizeShardExecution, summarizeStablecoinExposure, summarizeWeeklyTurnoverIntensity, testHypothesis, toUtcDate, windowChange } from './analytics.js';
import { DATA_SOURCES, fetchNeardataBlockTransactionCount, fetchCoinGeckoHistory, fetchCoinGeckoMarket, fetchDefiLlamaPrice, fetchFinalizedBlock, fetchProtocolConfig, fetchRpcStatus, fetchTvlHistory, fetchValidatorSet, fetchNearProtocolTvls, fetchNearStablecoins, fetchNearDexVolumeHistory, fetchNearFeesHistory, fetchNearPoolSnapshot, fetchAccountSnapshot } from './data.js';
import { CHART_QUERY_RECIPES, THESIS_TEST_RECIPE } from './query-registry.js';

import { replayChartInputs, replayRpcObservations } from './replay.js';
import { WORKSPACES, resolveWorkspace, isNearAccountId, estimateExecutionCost, toCsv } from './workspace.js';
import { createThesisTestEvidence } from './thesis.js';
const chartExportData = new Map();
let accountInspection = null;
let lastAccountRequestAt = 0;

const LOCAL_HISTORY_KEY = 'near-signal.rpc-observations.v2';
const STABLECOIN_HISTORY_KEY = 'near-signal.stablecoin-observations.v1';
const MAX_LOCAL_OBSERVATIONS = 60;
const $ = (selector) => document.querySelector(selector);
const state = {
  market: null, marketChart: null, llamaPrice: null, tvlHistory: null, nearProtocolTvls: null, nearStablecoins: null,
  dexVolumeHistory: null, feeHistory: null, nearPoolSnapshot: null, protocolConfig: null, blockActivity: null,
  block: null, rpcStatus: null, validators: null, sourceStatuses: new Map(), observations: readObservations(),
  stablecoinObservations: readStablecoinObservations(),
  chartMetric: 'priceUsd', days: 14, declineThreshold: 20, isRefreshing: false, rpcBusy: false, lastMarketRefresh: 0, lastChunkRequestAt: 0,
  inFlight: new Set(), failureCounts: new Map(), retryAt: new Map(), flightRecorderHeight: null,
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
const POOL_SNAPSHOT_INTERVAL_MS = 300_000;
const FEE_HISTORY_INTERVAL_MS = 1_800_000;
const PROTOCOL_CONFIG_INTERVAL_MS = 1_800_000;
const RISK_FEED_INTERVAL_MS = 1_800_000;
const MARKET_MANUAL_COOLDOWN_MS = 60_000;
const FIELD_SOURCE_IDS = { block: 'near-rpc-finalized', protocolConfig: 'near-rpc-protocol-config', blockActivity: 'fastnear-neardata-block-transactions', rpcStatus: 'near-rpc-status', validators: 'near-rpc-validators', market: 'coingecko-market', marketChart: 'coingecko-history', llamaPrice: 'defillama-price', tvlHistory: 'defillama-tvl', nearProtocolTvls: 'defillama-near-protocol-tvls', nearStablecoins: 'defillama-near-stablecoins', dexVolumeHistory: 'defillama-near-dex-volume', feeHistory: 'defillama-near-fees', nearPoolSnapshot: 'geckoterminal-near-pools' };
const RISK_SOURCE_IDS = {
  concentration: ['near-rpc-validators'], activity: ['fastnear-neardata-block-transactions'],
  capital: ['defillama-tvl', 'coingecko-history'], infrastructure: ['near-rpc-finalized', 'near-rpc-status'],
  economics: ['coingecko-market', 'near-rpc-finalized'],
  'validator-performance': ['near-rpc-validators'],
};

function readObservations() {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY) || '[]');
    return Array.isArray(rows) ? replayRpcObservations(rows).slice(-MAX_LOCAL_OBSERVATIONS) : [];
  } catch { return []; }
}
function readStablecoinObservations() {
  try {
    const value = JSON.parse(localStorage.getItem(STABLECOIN_HISTORY_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([id, rows]) => [id,
      Array.isArray(rows) ? rows.filter((row) => Number.isFinite(Date.parse(row?.checkedAt)) && Number.isFinite(Number(row?.priceUsd))).slice(-120) : [],
    ]));
  } catch { return {}; }
}
function persistObservations() { try { localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(state.observations.slice(-MAX_LOCAL_OBSERVATIONS))); } catch { /* Browser storage may be disabled. */ } }
function persistStablecoinObservations() { try { localStorage.setItem(STABLECOIN_HISTORY_KEY, JSON.stringify(state.stablecoinObservations)); } catch { /* Browser storage may be disabled. */ } }
function recordStablecoinObservations(data) {
  const checkedAt = data?.fetchedAt;
  if (!Number.isFinite(Date.parse(checkedAt)) || !Array.isArray(data?.assets)) return;
  const cutoff = Date.now() - 72 * 3600_000;
  for (const asset of data.assets) {
    if (!asset?.id || !Number.isFinite(Number(asset.priceUsd)) || Number(asset.priceUsd) <= 0) continue;
    const rows = state.stablecoinObservations[asset.id] || [];
    if (rows.at(-1)?.checkedAt === checkedAt) continue;
    state.stablecoinObservations[asset.id] = [...rows.filter((row) => Date.parse(row.checkedAt) >= cutoff), { checkedAt, priceUsd: Number(asset.priceUsd) }].slice(-120);
  }
  persistStablecoinObservations();
}
function mergeSourceStatus(status) { if (status?.sourceId) state.sourceStatuses.set(status.sourceId, status); }
function applyResult(field, result) {
  if (Object.hasOwn(result ?? {}, 'value')) {
    state[field] = result.value;
    if (field === 'nearStablecoins' && result?.status?.ok) recordStablecoinObservations(result.value);
  }
  mergeSourceStatus(result?.status);
}
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
function fullDayUsdRows(rows, valueKey = 'valueUsd', dateKey = 'date', timestampUnit = 'date') {
  const today = new Date().toISOString().slice(0, 10);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    date: timestampUnit === 'date' ? String(row?.[dateKey] ?? '').slice(0, 10) : toUtcDate(row?.[dateKey], timestampUnit),
    valueUsd: Number(row?.[valueKey]),
  })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date < today && Number.isFinite(row.valueUsd) && row.valueUsd >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function renderSimpleTable(selector, caption, headers, rows, emptyText) {
  const container = typeof selector === 'string' ? $(selector) : selector;
  if (!container) return;
  if (!Array.isArray(rows) || rows.length === 0) { container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyText)}</div>`; return; }
  const head = headers.map((value) => `<th scope="col">${escapeHtml(value)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  container.innerHTML = `<table class="data-table"><caption class="sr-only">${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function feedStateLabel(sourceId, hasData) {
  const status = state.sourceStatuses.get(sourceId);
  if (!status) return hasData ? 'Prior observation retained' : 'Checking source';
  if (status.ok === false) return hasData ? 'Latest read failed · prior data retained' : 'Unavailable';
  if (sourceIsStale(status)) return 'Stale provider observation';
  if (status.partial) return status.detail || 'Partial response';
  return status.ok ? 'Live source responding' : 'Checking source';
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
  const observedAt = Date.parse(status?.providerAt ?? status?.lastProviderAt ?? status?.lastDataAt ?? status?.checkedAt);
  return Boolean(source?.staleAfterSeconds && Number.isFinite(observedAt) && Date.now() - observedAt > source.staleAfterSeconds * 1000);
}
function failedSources(sourceIds) {
  return (Array.isArray(sourceIds) ? sourceIds : [sourceIds]).filter((sourceId) => state.sourceStatuses.get(sourceId)?.ok === false);
}
function allSourcesFailed(sourceIds) {
  const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
  return ids.length > 0 && ids.every((sourceId) => state.sourceStatuses.get(sourceId)?.ok === false);
}
function unavailableOrWaiting(sourceIds, waiting) { return allSourcesFailed(sourceIds) ? 'Unavailable' : waiting; }
function sourceFailureText(sourceIds) {
  return failedSources(sourceIds).map((sourceId) => {
    const source = DATA_SOURCES.find((item) => item.id === sourceId), status = state.sourceStatuses.get(sourceId);
    return `${source?.name ?? sourceId}: ${status?.detail || 'latest request failed'}${status?.retryAt ? `; retry scheduled ${utcDateTime(status.retryAt)}` : ''}`;
  }).join(' · ');
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
  const spotSources = ['coingecko-market', 'defillama-price'];
  const spotFailure = sourceFailureText(spotSources), marketFailure = sourceFailureText('coingecko-market');
  const dailyFailure = sourceFailureText(['coingecko-history', 'defillama-tvl']);
  const currentPrice = state.market?.priceUsd ?? state.llamaPrice?.priceUsd ?? null;
  $('#marketPrice').textContent = currentPrice === null ? unavailableOrWaiting(spotSources, 'Waiting for market feed') : usd(currentPrice, currentPrice < 1 ? 4 : 2);
  $('#marketPriceFoot').textContent = state.market?.timestamp ? `CoinGecko provider time: ${utcDateTime(state.market.timestamp)} · fetched ${ago(state.market.fetchedAt)}${marketFailure ? ' · latest read failed; prior value retained' : ''}` : marketFallback ? `DefiLlama fallback price · provider time ${utcDateTime(state.llamaPrice.timestamp)}${spotFailure ? ` · latest source warning: ${spotFailure}` : ''}` : spotFailure ? `Live price read failed: ${spotFailure}` : 'Waiting for a timestamped market snapshot';
  $('#marketChange').textContent = state.market?.priceChange24hPct === null || state.market?.priceChange24hPct === undefined ? unavailableOrWaiting('coingecko-market', 'Waiting for live 24-hour change') : formatSignedPercent(state.market.priceChange24hPct, 2);
  $('#marketChangeFoot').textContent = state.market?.timestamp ? `CoinGecko provider time: ${utcDateTime(state.market.timestamp)} · exchange-aggregated${marketFailure ? ' · latest read failed; prior value retained' : ''}` : marketFailure ? `CoinGecko read failed: ${marketFailure}` : 'Awaiting a timestamped CoinGecko observation';
  const blockFailure = sourceFailureText('near-rpc-finalized');
  $('#finalizedBlock').textContent = state.block ? compact(state.block.height, 0) : unavailableOrWaiting('near-rpc-finalized', 'Waiting for finalized block');
  $('#finalizedBlockFoot').textContent = state.block ? `Finalized · block time ${utcDateTime(state.block.timestamp)} · fetched ${ago(state.block.fetchedAt)}${blockFailure ? ' · latest read failed; prior value retained' : ''}` : blockFailure ? `Latest RPC read failed: ${blockFailure}` : 'Waiting for NEAR mainnet RPC';
  renderBlockAge();
  const chartRows = daily.slice(-(state.days + 1)), metric = state.chartMetric, meta = METRICS[metric] || METRICS.priceUsd;
  renderLineChart($('#overviewChart'), chartRows, metric, { label: meta.label, color: meta.color, format: meta.format, emptyText: dailyFailure ? `Unavailable: ${dailyFailure}` : 'No matched dated series yet. Current live spot data is shown above; the chart requires matching daily price and TVL dates.' });
  $('#observedSpan').textContent = chartRows.length > 1 ? `${chartRows.length} matched dates · ${chartRows[0].date} to ${chartRows.at(-1).date}` : dailyFailure || 'Waiting for matched daily observations';
  $('#dataAsOf').textContent = `Daily series through ${daily.at(-1)?.date ?? '—'} UTC${dailyFailure ? ` · latest history read failed; prior/partial range retained: ${dailyFailure}` : ''}`;
  $('#overviewChartSubtitle').textContent = `${meta.label}; matched UTC dates only, current partial UTC day excluded.`;
  const tvl7d = windowChange(daily, 'tvlUsd', 7), tvl30d = windowChange(daily, 'tvlUsd', 30);
  const dims = [
    ['Finalized NEAR block', state.block ? `Block ${compact(state.block.height, 0)} observed` : unavailableOrWaiting('near-rpc-finalized', 'Waiting for live block')],
    ['Verified block activity', state.blockActivity ? `${compact(state.blockActivity.transactionCount, 0)} transactions in one block` : 'Waiting for complete shard match'],
    ['Current validator snapshot', state.validators ? `${compact(state.validators.validatorCount, 0)} active-set records` : 'Waiting for live validator set'],
    ['Market and TVL context', state.market && state.tvlHistory ? dailyFailure ? 'Partial data · latest history read failed' : 'Market snapshot and daily TVL loaded' : dailyFailure ? 'Unavailable: a history feed failed' : 'Checking connected market feeds'],
  ];
  $('#dimensionList').innerHTML = dims.map(([name, status]) => `<div class="dimension-row"><span>${escapeHtml(name)}</span><span class="dim-status">${escapeHtml(status)}</span></div>`).join('');
  const nodeSync = typeof state.rpcStatus?.syncing === 'boolean' ? (state.rpcStatus.syncing ? 'syncing' : 'not syncing') : 'not reported';
  const nodeHeight = state.rpcStatus?.sync_info?.latest_block_height ? ` · RPC node latest height ${compact(state.rpcStatus.sync_info.latest_block_height, 0)}` : '';
  const activityText = state.blockActivity ? ` Most recent sampled block ${compact(state.blockActivity.blockHeight, 0)} contains ${compact(state.blockActivity.transactionCount, 0)} transactions across ${state.blockActivity.shardCount ?? state.blockActivity.chunkCount} shards; ${state.blockActivity.chunkCount} newly included chunks were verified${state.blockActivity.reusedShardCount ? ` and ${state.blockActivity.reusedShardCount} prior-height reference${state.blockActivity.reusedShardCount === 1 ? '' : 's'} counted as zero` : ''}.` : ' Waiting for a complete per-block transaction sample.';
  $('#liveSummary').textContent = state.block ? `Finalized block ${compact(state.block.height, 0)} · ${state.block.activeChunks}/${state.block.chunkCount} chunks used gas · ${state.block.gasUtilizationPct?.toFixed(2) ?? '—'}% of reported chunk gas limits.${activityText} RPC node reports ${nodeSync}${nodeHeight}.${blockFailure ? ` Latest block request failed: ${blockFailure}.` : ''}` : blockFailure ? `Unavailable: latest finalized-block request failed (${blockFailure}). RPC node reports ${nodeSync}${nodeHeight}.` : `Waiting for live finalized block. RPC node reports ${nodeSync}${nodeHeight}.`;
  $('#contextSummary').textContent = daily.length ? `${daily.length} complete matched daily dates; current UTC date excluded${dailyFailure ? `; latest history read failed and the prior/partial range is retained (${dailyFailure})` : ''}. TVL change: 7-day ${tvl7d ? formatSignedPercent(tvl7d.changePct) : dailyFailure ? 'unavailable' : 'waiting for 8 consecutive dates'}, 30-day ${tvl30d ? formatSignedPercent(tvl30d.changePct) : dailyFailure ? 'unavailable' : 'waiting for 31 consecutive dates'}.` : dailyFailure ? `Daily history unavailable: ${dailyFailure}` : 'Waiting for complete matched UTC-date history from market and TVL feeds.';
  $('#gapSummary').textContent = 'A block-local transaction count describes one sample, not a daily or unique-user adoption measure. Market volume and TVL are context signals, not directional net flows.';
}
function renderBlockAge() {
  if (!state.block) { const failure = sourceFailureText('near-rpc-finalized'); $('#blockAge').textContent = unavailableOrWaiting('near-rpc-finalized', 'Waiting'); $('#blockAgeFoot').textContent = failure ? `Finalized-block read failed: ${failure}` : 'Waiting for NEAR mainnet RPC'; return; }
  const age = Math.max(0, (Date.now() - state.block.timestampMs) / 1000);
  $('#blockAge').textContent = `${age.toFixed(1)} sec`;
  const failure = sourceFailureText('near-rpc-finalized');
  $('#blockAgeFoot').textContent = `Finalized block time ${utcDateTime(state.block.timestamp)} · last fetched ${ago(state.block.fetchedAt)}${failure ? ` · latest read failed: ${failure}` : ''}`;
}
function renderValueCapture() {
  const block = state.block;
  const blockFailure = sourceFailureText('near-rpc-finalized');
  const blockMissing = unavailableOrWaiting('near-rpc-finalized', 'Waiting for block');
  $('#valueStatus').textContent = block ? (blockFailure ? 'Retained block estimate' : 'Live block estimate') : unavailableOrWaiting('near-rpc-finalized', 'Waiting for finalized block');
  $('#valueStatus').className = `status-pill ${block && !blockFailure ? 'good' : 'warn'}`;
  $('#blockGasCost').textContent = block ? `${block.estimatedGasFeeNear.toFixed(6)} Ⓝ` : blockMissing;
  $('#blockGasUsed').textContent = block ? `${(block.gasUsed / 1e12).toFixed(2)} Tgas` : blockMissing;
  $('#blockGasUsedFoot').textContent = block ? `${block.activeChunks}/${block.chunkCount} returned chunks have non-zero gas used${blockFailure ? ' · latest block read failed; prior value retained' : ''}` : blockFailure || 'Waiting for finalized chunk data';
  $('#blockGasUtil').textContent = block?.gasUtilizationPct === null || !block ? blockMissing : `${block.gasUtilizationPct.toFixed(2)}%`;
  $('#blockGasUtilFoot').textContent = block ? `Block ${compact(block.height, 0)} · ${utcDateTime(block.timestamp)}${blockFailure ? ' · latest block read failed; prior value retained' : ''}` : blockFailure || 'Waiting for finalized chunk data';
  $('#gasPrice').textContent = block ? `${block.gasPriceNearPerTgas.toFixed(6)} Ⓝ` : blockMissing;
  $('#marketCap').textContent = state.market?.marketCapUsd === null || state.market?.marketCapUsd === undefined ? unavailableOrWaiting('coingecko-market', 'Waiting for market feed') : shortUsd(state.market.marketCapUsd);
  $('#grossVolume').textContent = state.market?.grossVolume24hUsd === null || state.market?.grossVolume24hUsd === undefined ? unavailableOrWaiting('coingecko-market', 'Waiting for market feed') : shortUsd(state.market.grossVolume24hUsd);
  const coinGeckoTime = Date.parse(state.market?.timestamp ?? ''), llamaTime = Date.parse(state.llamaPrice?.timestamp ?? '');
  const bothSpotPrices = Number.isFinite(state.market?.priceUsd) && state.market.priceUsd > 0 && Number.isFinite(state.llamaPrice?.priceUsd) && state.llamaPrice.priceUsd > 0;
  const timestampsValid = Number.isFinite(coinGeckoTime) && Number.isFinite(llamaTime);
  const timestampGapMs = timestampsValid ? Math.abs(coinGeckoTime - llamaTime) : null;
  const spotGap = bothSpotPrices && timestampsValid && timestampGapMs <= 300_000 ? Math.abs(state.market.priceUsd - state.llamaPrice.priceUsd) / state.market.priceUsd * 100 : null;
  const spotFailure = sourceFailureText(['coingecko-market', 'defillama-price']), marketFailure = sourceFailureText('coingecko-market');
  $('#spotDifference').textContent = spotGap === null ? (bothSpotPrices && timestampsValid ? 'Not time-matched' : unavailableOrWaiting(['coingecko-market', 'defillama-price'], 'Waiting for two spot feeds')) : `${spotGap.toFixed(2)}%`;
  $('#marketCapTime').textContent = state.market?.timestamp ? `CoinGecko ${utcDateTime(state.market.timestamp)}${marketFailure ? ' · latest read failed; prior value retained' : ''}` : marketFailure || 'Waiting for provider timestamp';
  $('#grossVolumeTime').textContent = state.market?.timestamp ? `CoinGecko ${utcDateTime(state.market.timestamp)}${marketFailure ? ' · latest read failed; prior value retained' : ''}` : marketFailure || 'Waiting for provider timestamp';
  $('#spotDifferenceFoot').textContent = timestampsValid ? timestampGapMs <= 300_000 ? `CoinGecko ${utcDateTime(state.market.timestamp)} · DefiLlama ${utcDateTime(state.llamaPrice.timestamp)}${spotFailure ? ` · latest read failed: ${spotFailure}` : ''}` : `Not compared: provider timestamps differ by ${(timestampGapMs / 60_000).toFixed(1)} minutes` : spotFailure || 'Waiting for both timestamped spot feeds';
  renderFeeEstimate();
  const observations = state.observations.map((row) => ({ ...row, gasTgas: Number(row.gasUsed) / 1e12 }));
  renderLineChart($('#gasChart'), observations, 'gasTgas', { label: 'Gas used per sampled finalized block', color: '#197e78', format: 'tgas', dateKey: 'observedAt', emptyText: 'Collecting real finalized-block observations. No historical values are fabricated.' });
  $('#blockHistoryStatus').textContent = observations.length ? `${observations.length} live block sample${observations.length === 1 ? '' : 's'}` : 'Collecting observations';
  $('#blockHistorySpan').textContent = observations.length > 1 ? `${utcDateTime(observations[0].observedAt)} to ${utcDateTime(observations.at(-1).observedAt)}` : 'A local time series appears after multiple polls.';

  const feeRows = fullDayUsdRows(state.feeHistory?.rows);
  const feeLatest = feeRows.at(-1), fee7d = completeWindowSum(feeRows, 'valueUsd', 7), fee7dChange = completeWindowSumChange(feeRows, 'valueUsd', 7);
  $('#latestFeeDaily').textContent = feeLatest ? shortUsd(feeLatest.valueUsd) : unavailableOrWaiting('defillama-near-fees', 'Waiting for dated fee observation');
  $('#feeDailyAsOf').textContent = feeLatest ? `${feeLatest.date} UTC · DefiLlama-indexed` : sourceFailureText('defillama-near-fees') || 'No complete daily point';
  $('#fees7d').textContent = fee7d ? shortUsd(fee7d.sum) : unavailableOrWaiting('defillama-near-fees', 'Waiting for 7 consecutive dates');
  $('#fees7dFoot').textContent = fee7d ? `${fee7d.startDate} to ${fee7d.endDate} · exact 7-day sum` : 'Requires 7 consecutive dated observations';
  $('#fees7dChange').textContent = fee7dChange ? formatSignedPercent(fee7dChange.changePct) : unavailableOrWaiting('defillama-near-fees', 'Waiting for 14 consecutive dates');
  $('#fees7dChangeFoot').textContent = fee7dChange ? `${shortUsd(fee7dChange.previous.sum)} prior · ${shortUsd(fee7dChange.current.sum)} current` : 'Requires 14 consecutive dated observations';
  renderLineChart($('#feeHistoryChart'), feeRows.slice(-365), 'valueUsd', { label: 'DefiLlama-indexed NEAR daily chain fees, USD', color: '#c1783a', format: 'usd', emptyText: sourceFailureText('defillama-near-fees') ? `Unavailable: ${sourceFailureText('defillama-near-fees')}` : 'Waiting for a dated fee history.' });
  $('#feeHistorySpan').textContent = feeRows.length ? `${feeRows.length} complete UTC dates · ${feeRows[0].date} to ${feeRows.at(-1).date} · chart shows the latest 365` : 'Waiting for dated fee observations';
  $('#feeHistoryFreshness').textContent = state.feeHistory?.fetchedAt ? `Fetched ${ago(state.feeHistory.fetchedAt)}` : 'No successful fetch';
  const feeStatus = state.sourceStatuses.get('defillama-near-fees'), feeStatusEl = $('#feeHistoryStatus');
  feeStatusEl.textContent = feedStateLabel('defillama-near-fees', Boolean(state.feeHistory?.rows?.length));
  feeStatusEl.className = `status-pill ${feeStatus?.ok && !sourceIsStale(feeStatus) ? 'good' : 'warn'}`;

  const config = state.protocolConfig, ratio = config?.burntGasReward;
  $('#contractRebateShare').textContent = ratio ? `${ratio.contractRebatePct.toFixed(1)}%` : unavailableOrWaiting('near-rpc-protocol-config', 'Waiting for matching protocol rule');
  $('#eligibleGasBurnShare').textContent = ratio ? `${ratio.eligibleGasBurnPct.toFixed(1)}%` : unavailableOrWaiting('near-rpc-protocol-config', 'Not inferred without config');
  $('#feeRuleVersion').textContent = config ? `Protocol ${config.protocolVersion} · block ${compact(config.blockHeight, 0)}` : sourceFailureText('near-rpc-protocol-config') || 'Waiting for block-matched config';
  $('#feeRuleAsOf').textContent = config ? `Rule fetched ${utcDateTime(config.fetchedAt)} · ${config.burntGasReward ? `${ratio.numerator}/${ratio.denominator} gas-reward ratio` : 'ratio not reported'}` : sourceFailureText('near-rpc-protocol-config') || 'Not inferred without config';
  const configStatus = state.sourceStatuses.get('near-rpc-protocol-config');
  $('#feeRuleStatus').textContent = feedStateLabel('near-rpc-protocol-config', Boolean(config));
  $('#feeRuleStatus').className = `status-pill ${config && config.burntGasReward && configStatus?.ok !== false && !sourceIsStale(configStatus) ? 'good' : 'warn'}`;
  const reward = state.validators?.validatorRewardPaidPrevEpochNear;
  $('#validatorRewardPaid').textContent = Number.isFinite(reward) ? `${compact(reward, 3)} Ⓝ` : unavailableOrWaiting('near-rpc-validators', 'Unavailable');
  $('#validatorRewardFoot').textContent = state.validators?.validatorRewardPaidPrevEpochYocto ? `${state.validators.validatorRewardRecipientCount ?? '—'} recipients · prior epoch · inflationary budget, not tx-fee revenue` : sourceFailureText('near-rpc-validators') || 'Prior-epoch reward map not returned';
  const shards = (block?.chunkGas ?? []).slice().sort((a, b) => (a.shardId ?? -1) - (b.shardId ?? -1));
  renderSimpleTable('#shardGasTable', 'Per-shard gas in the latest finalized block', ['Shard', 'Gas used · Tgas', 'Reported limit · Tgas', 'Utilization', 'Estimated gas value · NEAR'], shards.map((row) => [row.shardId ?? '—', Number.isFinite(row.gasUsedTgas) ? row.gasUsedTgas.toFixed(2) : '—', Number.isFinite(row.gasLimit) ? (row.gasLimit / 1e12).toFixed(2) : '—', Number.isFinite(row.gasUtilizationPct) ? `${row.gasUtilizationPct.toFixed(2)}%` : 'Unavailable', Number.isFinite(row.gasFeeNear) ? row.gasFeeNear.toFixed(6) : '—']), block ? 'No per-shard gas values were returned.' : 'Waiting for finalized per-shard block data.');
}

function renderParticipation() {
  const validators = state.validators;
  const validatorFailure = sourceFailureText('near-rpc-validators');
  const validatorPlaceholder = unavailableOrWaiting('near-rpc-validators', 'Waiting for live feed');
  $('#validatorCount').textContent = validators ? compact(validators.validatorCount, 0) : validatorPlaceholder;
  $('#validatorEpoch').textContent = validators?.epochHeight === null || validators?.epochHeight === undefined ? validatorFailure || 'Waiting for current epoch' : `Epoch height ${compact(validators.epochHeight, 0)} · ${validators.nextValidatorCount ?? '—'} next-set records`;
  $('#validatorTop10').textContent = validators ? `${validators.top10SharePct.toFixed(1)}%` : validatorPlaceholder;
  $('#validatorHhi').textContent = validators ? `Current-set stake HHI: ${validators.hhi.toFixed(0)} · top one ${Number.isFinite(validators.top1SharePct) ? `${validators.top1SharePct.toFixed(1)}%` : 'unavailable'}` : `${validatorPlaceholder} · no concentration estimate`;
  $('#validatorProduction').textContent = validators?.blockProductionPct === null || !validators ? validatorPlaceholder : `${validators.blockProductionPct.toFixed(1)}%`;
  $('#validatorProductionFoot').textContent = validators ? `${compact(validators.producedBlocks, 0)} produced / ${compact(validators.expectedBlocks, 0)} expected blocks in returned epoch counters${validatorFailure ? ` · latest read failed: ${validatorFailure}` : ''}` : validatorFailure || 'Waiting for current epoch counters';
  $('#validatorSetSummary').textContent = validators ? `Epoch ${compact(validators.epochHeight, 0)} · ${compact(validators.validatorCount, 0)} current / ${compact(validators.nextValidatorCount, 0)} next · ${compact(validators.totalStakeNear, 2)} Ⓝ current-set stake · snapshot ${utcDateTime(validators.asOf)}` : validatorFailure || 'Waiting for validator snapshot';
  $('#validatorProposalCount').textContent = Number.isFinite(validators?.proposalCount) ? compact(validators.proposalCount, 0) : validatorPlaceholder;
  $('#validatorSlashedCount').textContent = Number.isFinite(validators?.slashedValidatorCount) ? compact(validators.slashedValidatorCount, 0) : validatorPlaceholder;
  $('#validatorKickoutSummary').textContent = validators ? `${validators.prevEpochKickouts?.length ?? 0} previous-epoch kickout records` : validatorFailure || 'Prior-epoch kickouts unavailable';
  $('#validatorSetTransition').textContent = validators ? `${validators.nextSetAddedCount} added · ${validators.nextSetRemovedCount} removed` : validatorPlaceholder;
  $('#validatorSetTransitionFoot').textContent = validators ? `${validators.nextSetContinuedCount} account IDs continued into the next set · proposal list separate` : validatorFailure || 'Set changes unavailable';
  const current = validators?.currentValidators ?? [], next = validators?.nextValidators ?? [];
  renderSimpleTable('#validatorCurrentTable', 'Twenty highest-stake current validators', ['#', 'Validator account', 'Stake · Ⓝ', 'Stake share', 'Blocks', 'Chunks', 'Endorsements', 'Slashed'], current.slice(0, 20).map((row, index) => [index + 1, row.accountId, compact(row.stakeNear, 2), Number.isFinite(row.stakeSharePct) ? `${row.stakeSharePct.toFixed(3)}%` : '—', Number.isFinite(row.blockProductionPct) ? `${row.blockProductionPct.toFixed(1)}%` : '—', Number.isFinite(row.chunkProductionPct) ? `${row.chunkProductionPct.toFixed(1)}%` : '—', Number.isFinite(row.endorsementProductionPct) ? `${row.endorsementProductionPct.toFixed(1)}%` : '—', row.isSlashed ? 'Yes' : 'No']), validatorFailure || 'Current validator rows unavailable');
  const currentIds = new Set(current.map((row) => row.accountId));
  renderSimpleTable('#validatorNextTable', 'Twenty highest-stake next validators', ['#', 'Validator account', 'Stake · Ⓝ', 'Assigned shards', 'Set status'], next.slice(0, 20).map((row, index) => [index + 1, row.accountId, Number.isFinite(row.stakeNear) ? compact(row.stakeNear, 2) : 'Unavailable', Number.isFinite(row.shardCount) ? row.shardCount : 'Unavailable', currentIds.has(row.accountId) ? 'Continued' : 'New to next set']), validatorFailure || 'Next validator rows unavailable');
  const activity = state.blockActivity;
  const sourceStatus = state.sourceStatuses.get('fastnear-neardata-block-transactions');
  const activityFailure = sourceFailureText('fastnear-neardata-block-transactions');
  const activityPlaceholder = unavailableOrWaiting('fastnear-neardata-block-transactions', 'Waiting for sample');
  $('#blockTxLatest').textContent = activity ? compact(activity.transactionCount, 0) : activityPlaceholder;
  $('#blockTxAsOf').textContent = activity ? `Finalized block ${compact(activity.blockHeight, 0)} · ${activity.chunkCount} new chunks / ${activity.shardCount ?? activity.chunkCount} shards${activity.reusedShardCount ? ` · ${activity.reusedShardCount} prior-height reference${activity.reusedShardCount === 1 ? '' : 's'} counted as zero` : ''} · ${utcDateTime(activity.blockTimestamp)}${activityFailure ? ` · latest read failed; prior sample retained: ${activityFailure}` : ''}` : activityFailure || 'Waiting for complete all-shard count';
  $('#blockTxChunks').textContent = activity ? compact(activity.chunkCount, 0) : activityPlaceholder;
  $('#blockTxFreshness').textContent = activity?.fetchedAt ? `Sampled ${ago(activity.fetchedAt)} · current-height chunk matches, prior-height references and transaction hashes are retained for offline replay; full transaction bodies and receipts are discarded.${activityFailure ? ` Latest read failed: ${activityFailure}` : ''}` : activityFailure ? `Latest sample unavailable: ${activityFailure}` : 'Requesting a complete finalized-block sample.';
  $('#activityStatus').textContent = activity ? (sourceStatus?.ok === false ? 'Prior sample retained · latest read failed' : 'Live block count observed') : (sourceStatus?.ok === false ? 'Sample unavailable' : 'Sampling finalized chunks');
  $('#activityStatus').className = `status-pill ${activity && sourceStatus?.ok !== false ? 'good' : 'warn'}`;
  const observations = state.observations;
  renderLineChart($('#blockTxChart'), observations, 'transactionCount', { label: 'Transactions per sampled finalized block', color: '#7f61a6', format: 'count', dateKey: 'observedAt', emptyText: 'Waiting for at least two complete live samples. No historical transaction values are fabricated.' });
  const samples = observations.filter((row) => Number.isSafeInteger(row.transactionCount));
  $('#blockTxHistoryStatus').textContent = `${samples.length} complete local samples`;
  $('#blockTxHistorySpan').textContent = samples.length > 1 ? `${utcDateTime(samples[0].transactionFetchedAt)} to ${utcDateTime(samples.at(-1).transactionFetchedAt)}` : 'A local sample history appears after more five-minute polls.';

  const block = state.block, gasByShard = new Map((block?.chunkGas ?? []).map((row) => [row.shardId, row]));
  const txByShard = new Map((activity?.chunks ?? []).map((row) => [row.shardId, row]));
  const refs = new Map((block?.chunkRefs ?? []).map((row) => [row.shardId, row]));
  const shardIds = [...new Set([...gasByShard.keys(), ...txByShard.keys()])].sort((a, b) => a - b);
  const shardRows = shardIds.map((shardId) => {
    const gas = gasByShard.get(shardId), tx = txByShard.get(shardId), ref = refs.get(shardId);
    const included = Number.isFinite(ref?.heightIncluded) && Number.isFinite(block?.height) ? (ref.heightIncluded === block.height ? 'Newly included' : 'Prior-height reference') : 'Unavailable';
    return [shardId, included, gas && Number.isFinite(gas.gasUsedTgas) ? gas.gasUsedTgas.toFixed(2) : 'Unavailable', gas && Number.isFinite(gas.gasUtilizationPct) ? `${gas.gasUtilizationPct.toFixed(1)}%` : 'Unavailable', tx ? compact(tx.transactionCount, 0) : activity ? 'No matched record' : 'Waiting'];
  });
  renderSimpleTable('#shardActivityTable', 'Gas and exact-height transaction sample by shard', ['Shard', 'Block reference', 'Gas used · Tgas', 'Gas utilization', 'Transactions in sample'], shardRows, 'Waiting for complete block and shard sample.');
  $('#shardActivitySummary').textContent = block && activity ? `Block ${compact(block.height, 0)} · ${activity.transactionCount} transactions · ${activity.chunkCount} newly included chunks` : block ? `Block ${compact(block.height, 0)} gas loaded · waiting for exact-height transaction sample` : activityFailure || 'Waiting for exact-height sample';
}

function riskPillClass(tone) { return tone === 'high' || tone === 'critical' ? 'bad' : tone === 'positive' ? 'good' : tone === 'caution' ? 'warn' : ''; }
function renderRiskSources(risk) {
  return (risk.sourceIds || RISK_SOURCE_IDS[risk.id] || []).map((sourceId) => {
    const source = DATA_SOURCES.find((item) => item.id === sourceId);
    if (!source) return '';
    const status = state.sourceStatuses.get(sourceId);
    let label = 'Checking first live read';
    if (status?.partial) label = `${status.detail || 'Partial source response'}${sourceIsStale(status) ? '; available observations are stale' : ''}`;
    else if (status && sourceIsStale(status)) label = status.ok === false ? 'Latest read failed; retained observation is stale' : 'Observation is stale';
    else if (status?.ok) label = 'Responding';
    else if (status?.ok === false && dataAvailableFor(sourceId)) label = 'Latest read failed; prior observation retained';
    else if (status?.ok === false) label = 'Not responding';
    const providerAt = status?.providerAt ?? status?.lastProviderAt;
    const freshnessTime = providerAt ?? status?.lastDataAt ?? status?.checkedAt;
    const freshnessLabel = providerAt ? 'provider ' : status?.lastDataAt ? 'last successful check ' : 'checked ';
    const freshness = freshnessTime ? ` · ${freshnessLabel}${utcDateTime(freshnessTime)}` : '';
    return `<span class="risk-source-item"><a href="${escapeHtml(source.docUrl || source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a> <small>${escapeHtml(label + freshness)}</small></span>`;
  }).filter(Boolean).join(' · ');
}
function renderRisks() {
  const daily = allDailyRows(), tvl7d = windowChange(daily, 'tvlUsd', 7), tvl30d = windowChange(daily, 'tvlUsd', 30);
  const market = state.market ? { priceChange24h: state.market.priceChange24hPct, priceUsd: state.market.priceUsd, timestamp: state.market.timestamp } : null;
  const rpcStatus = state.rpcStatus?.chain_id === 'mainnet' ? state.rpcStatus : null;
  const block = state.block ? { ...state.block, ageSeconds: (Date.now() - state.block.timestampMs) / 1000 } : null;
  const risks = assessLiveRisks({ market, tvl7d, tvl30d, validators: state.validators, block, rpcStatus, blockActivity: state.blockActivity, nearProtocolTvls: state.nearProtocolTvls, nearStablecoins: state.nearStablecoins, stablecoinHistory: state.stablecoinObservations, declineThreshold: state.declineThreshold });
  const filter = $('#riskFilter')?.value || 'all';
  const activeRisk = (risk) => risk.active === true || ['high', 'critical'].includes(risk.tone) || (risk.id === 'infrastructure' && risk.tone === 'caution');
  const visibleRisks = risks.filter((risk) => filter === 'all' || activeRisk(risk));
  const alerts = risks.filter(activeRisk).length;
  $('#riskFilterStatus').textContent = `${visibleRisks.length} live signals · ${alerts} active finding${alerts === 1 ? '' : 's'} · decline threshold ${state.declineThreshold}%`;
  $('#riskGrid').innerHTML = visibleRisks.map((risk) => {
    const sourceLinks = renderRiskSources(risk);
    return `<article class="card risk-card"><div class="risk-top"><h3>${escapeHtml(risk.title)}</h3><span class="status-pill ${riskPillClass(risk.tone)}">${escapeHtml(risk.state)}</span></div><p><strong>Severity:</strong> ${escapeHtml(risk.severity)}</p><p><strong>Trend:</strong> ${escapeHtml(risk.trend)}</p><p><strong>Evidence:</strong> ${escapeHtml(risk.evidence)}</p>${risk.query ? `<p><strong>Reproduction:</strong> <code>${escapeHtml(risk.query)}</code></p>` : ''}<p class="risk-source"><strong>Sources:</strong> ${sourceLinks || 'No source attribution available'}</p><p><strong>Confidence:</strong> ${escapeHtml(risk.confidence)}</p><p class="risk-impact"><strong>Potential impact:</strong> ${escapeHtml(risk.impact)}</p><p class="risk-next"><strong>Next check:</strong> ${escapeHtml(risk.next)}</p></article>`;
  }).join('');
  if (!visibleRisks.length) $('#riskGrid').innerHTML = risks.length ? '<div class="empty-state">No monitored signal crosses this threshold. A no-alert result is not proof that no risk exists.</div>' : '<div class="empty-state">Live risk cards appear when their source observations are loaded. No risk is inferred from missing data.</div>';
  $('#riskThresholdOutput').value = `${state.declineThreshold}%`;
  $('#riskThresholdOutput').textContent = `${state.declineThreshold}%`;
}
function renderCapital() {
  const tvlRows = fullDayUsdRows(state.tvlHistory?.rows, 'tvl', 'date', 's').map((row) => ({ ...row, tvlUsd: row.valueUsd }));
  const latest = tvlRows.at(-1), change7 = windowChange(tvlRows, 'tvlUsd', 7), change30 = windowChange(tvlRows, 'tvlUsd', 30);
  const tvlFailure = sourceFailureText('defillama-tvl'), missingData = tvlFailure ? 'Unavailable' : 'Waiting for daily TVL';
  $('#latestTvl').textContent = latest ? shortUsd(latest.tvlUsd) : missingData;
  $('#tvlAsOf').textContent = latest ? `DefiLlama daily asset stock · ${latest.date} UTC` : tvlFailure || 'Waiting for a dated source observation';
  $('#tvlChange7d').textContent = change7 ? formatSignedPercent(change7.changePct) : tvlFailure ? 'Unavailable' : 'Waiting for a complete window';
  $('#tvlSpan7d').textContent = change7 ? `${change7.startDate} to ${change7.endDate} · seven-day endpoint change` : 'Requires 8 consecutive daily observations';
  $('#tvlChange30d').textContent = change30 ? formatSignedPercent(change30.changePct) : tvlFailure ? 'Unavailable' : 'Waiting for a complete window';
  $('#tvlSpan30d').textContent = change30 ? `${change30.startDate} to ${change30.endDate} · thirty-day endpoint change` : 'Requires 31 consecutive daily observations';
  const chartDays = Number($('#capitalWindowSelect')?.value || 365), capitalRows = tvlRows.slice(-(chartDays + 1));
  renderLineChart($('#capitalChart'), capitalRows, 'tvlUsd', { label: 'NEAR DeFi total value locked, daily USD snapshot', color: '#197e78', format: 'usd', emptyText: tvlFailure ? `Unavailable: ${tvlFailure}` : 'Waiting for dated NEAR DeFi TVL observations.' });
  $('#tvlDateSpan').textContent = capitalRows.length ? `${capitalRows.length} complete daily observations · ${capitalRows[0].date} to ${capitalRows.at(-1).date}` : tvlFailure || 'No dated TVL series';
  $('#capitalFreshness').textContent = state.tvlHistory?.fetchedAt ? `Fetched ${ago(state.tvlHistory.fetchedAt)}` : tvlFailure || 'Source not yet fetched';
  const tvlStatus = state.sourceStatuses.get('defillama-tvl'), tvlStale = sourceIsStale(tvlStatus);
  $('#capitalStatus').textContent = !latest ? tvlFailure ? 'TVL unavailable' : 'Checking daily TVL' : tvlStale ? 'Stale TVL snapshot' : tvlStatus?.ok === false ? 'Retained TVL snapshot' : 'Live daily TVL';
  $('#capitalStatus').className = `status-pill ${latest && !tvlStale && tvlStatus?.ok !== false ? 'good' : 'warn'}`;
  const tvlReadState = tvlStale ? 'provider observation is stale' : tvlStatus?.ok === false ? dataAvailableFor('defillama-tvl') ? 'latest read failed; prior observation retained' : 'latest read failed; no TVL observation is available' : 'source responding';
  $('#capitalLastChecked').textContent = state.tvlHistory?.fetchedAt ? `Fetched ${utcDateTime(state.tvlHistory.fetchedAt)} · ${tvlReadState}; TVL chart uses its own dated history and does not require CoinGecko date matches.` : tvlFailure || 'Waiting for live TVL snapshots.';

  const dexRows = fullDayUsdRows(state.dexVolumeHistory?.rows), dexLatest = dexRows.at(-1), dex7d = completeWindowSum(dexRows, 'valueUsd', 7), dex7dChange = completeWindowSumChange(dexRows, 'valueUsd', 7);
  $('#latestDexDaily').textContent = dexLatest ? shortUsd(dexLatest.valueUsd) : unavailableOrWaiting('defillama-near-dex-volume', 'Waiting for dated DEX observation');
  $('#dexDailyAsOf').textContent = dexLatest ? `${dexLatest.date} UTC · provider-indexed` : sourceFailureText('defillama-near-dex-volume') || 'No complete daily point';
  $('#dex7d').textContent = dex7d ? shortUsd(dex7d.sum) : unavailableOrWaiting('defillama-near-dex-volume', 'Waiting for 7 consecutive dates');
  $('#dex7dFoot').textContent = dex7d ? `${dex7d.startDate} to ${dex7d.endDate} · exact 7-day sum` : 'Requires 7 consecutive dated observations';
  $('#dex7dChange').textContent = dex7dChange ? formatSignedPercent(dex7dChange.changePct) : unavailableOrWaiting('defillama-near-dex-volume', 'Waiting for 14 consecutive dates');
  $('#dex7dChangeFoot').textContent = dex7dChange ? `${shortUsd(dex7dChange.previous.sum)} prior · ${shortUsd(dex7dChange.current.sum)}` : 'Requires 14 consecutive dated observations';
  renderLineChart($('#dexVolumeChart'), dexRows.slice(-365), 'valueUsd', { label: 'NEAR chain DEX daily volume, USD notional', color: '#426da9', format: 'usd', emptyText: sourceFailureText('defillama-near-dex-volume') ? `Unavailable: ${sourceFailureText('defillama-near-dex-volume')}` : 'Waiting for a dated DEX history.' });
  $('#dexHistorySpan').textContent = dexRows.length ? `${dexRows.length} complete UTC dates · ${dexRows[0].date} to ${dexRows.at(-1).date} · chart shows the latest 365` : 'Waiting for dated DEX observations';
  const dexBreakdown = state.dexVolumeHistory?.latestFullDayBreakdown ?? [];
  $('#dexBreakdownDate').textContent = state.dexVolumeHistory?.latestFullDay ? `${state.dexVolumeHistory.latestFullDay} UTC · source-reported daily breakdown` : 'No dated protocol breakdown returned';
  renderSimpleTable('#dexBreakdownTable', 'Source-reported latest daily NEAR DEX volume by protocol', ['Protocol', 'Reported daily volume (USD)'], dexBreakdown.map((row) => [row.protocol, shortUsd(row.valueUsd)]), 'The provider returned no protocol breakdown for the latest complete daily point.');
  $('#dexHistoryFreshness').textContent = state.dexVolumeHistory?.fetchedAt ? `Fetched ${ago(state.dexVolumeHistory.fetchedAt)}` : 'No successful fetch';
  const dexStatus = state.sourceStatuses.get('defillama-near-dex-volume'), dexStatusEl = $('#dexVolumeStatus');
  dexStatusEl.textContent = feedStateLabel('defillama-near-dex-volume', Boolean(state.dexVolumeHistory?.rows?.length));
  dexStatusEl.className = `status-pill ${dexStatus?.ok && !sourceIsStale(dexStatus) ? 'good' : 'warn'}`;

  const snapshot = state.nearPoolSnapshot, pools = snapshot?.pools ?? [], poolStatus = state.sourceStatuses.get('geckoterminal-near-pools');
  $('#poolCount').textContent = snapshot ? compact(snapshot.returnedCount, 0) : unavailableOrWaiting('geckoterminal-near-pools', 'Waiting for pool page');
  $('#poolSnapshotAsOf').textContent = snapshot ? `Page ${snapshot.page} · fetched ${ago(snapshot.fetchedAt)}` : sourceFailureText('geckoterminal-near-pools') || 'No successful snapshot';
  const reserveRows = pools.filter((pool) => Number.isFinite(pool.reserveUsd) && pool.reserveUsd >= 0), volumeRows = pools.filter((pool) => Number.isFinite(pool.volume24hUsd) && pool.volume24hUsd >= 0);
  $('#poolPageReserves').textContent = reserveRows.length ? shortUsd(reserveRows.reduce((sum, pool) => sum + pool.reserveUsd, 0)) : unavailableOrWaiting('geckoterminal-near-pools', 'No reserve values returned');
  $('#poolPageVolume').textContent = volumeRows.length ? shortUsd(volumeRows.reduce((sum, pool) => sum + pool.volume24hUsd, 0)) : unavailableOrWaiting('geckoterminal-near-pools', 'No volume values returned');
  const poolStatusEl = $('#poolSnapshotStatus');
  poolStatusEl.textContent = feedStateLabel('geckoterminal-near-pools', Boolean(pools.length));
  poolStatusEl.className = `status-pill ${snapshot && poolStatus?.ok && !sourceIsStale(poolStatus) ? 'good' : 'warn'}`;
  renderSimpleTable('#nearPoolTable', 'NEAR GeckoTerminal page-one pools ordered by reserve', ['Pool', 'DEX', 'Pool address', 'Reserve · USD', '24h volume · USD', 'Buys / sells', '24h price change'], pools.map((pool) => [pool.name, pool.dexId || '—', pool.address, Number.isFinite(pool.reserveUsd) ? shortUsd(pool.reserveUsd) : 'Unavailable', Number.isFinite(pool.volume24hUsd) ? shortUsd(pool.volume24hUsd) : 'Unavailable', Number.isFinite(pool.buys24h) && Number.isFinite(pool.sells24h) ? `${compact(pool.buys24h, 0)} / ${compact(pool.sells24h, 0)}` : 'Unavailable', Number.isFinite(pool.priceChange24hPct) ? formatSignedPercent(pool.priceChange24hPct) : 'Unavailable']), sourceFailureText('geckoterminal-near-pools') || 'No pool rows were returned.');

  const protocols = state.nearProtocolTvls?.indexProtocols ?? [];
  $('#protocolIndexSummary').textContent = state.nearProtocolTvls ? `${compact(state.nearProtocolTvls.indexCount, 0)} indexed rows ≥ $100k · index fetched ${ago(state.nearProtocolTvls.fetchedAt)}` : sourceFailureText('defillama-near-protocol-tvls') || 'Waiting for index';
  renderSimpleTable('#protocolIndexTable', 'DefiLlama indexed eligible NEAR protocol rows', ['Protocol', 'Category', 'Reported NEAR-chain TVL · USD'], protocols.map((item) => [item.name, item.category, Number.isFinite(item.nearTvlUsd) ? shortUsd(item.nearTvlUsd) : 'Unavailable']), sourceFailureText('defillama-near-protocol-tvls') || 'No eligible protocol rows returned.');
  const histories = state.nearProtocolTvls?.protocols ?? [];
  $('#protocolHistorySummary').textContent = state.nearProtocolTvls ? `${histories.length}/${state.nearProtocolTvls.requestedCount} selected dated histories · ${state.nearProtocolTvls.returnedCount} returned` : sourceFailureText('defillama-near-protocol-tvls') || 'Waiting for selected history reads';
  renderSimpleTable('#protocolHistoryTable', 'Selected protocols with dated NEAR-chain TVL histories', ['Protocol', 'Category', 'Latest dated NEAR TVL', 'Observation date', '7-day change', '30-day change'], histories.map((item) => {
    const rows = (item.points ?? []).map((point) => ({ date: toUtcDate(point.date, 's'), totalLiquidityUsd: Number(point.totalLiquidityUsd) })).filter((point) => point.date && Number.isFinite(point.totalLiquidityUsd) && point.totalLiquidityUsd >= 0).sort((a, b) => a.date.localeCompare(b.date));
    const latestPoint = rows.at(-1), change7 = windowChange(rows, 'totalLiquidityUsd', 7), change30 = windowChange(rows, 'totalLiquidityUsd', 30);
    return [item.name, item.category, latestPoint ? shortUsd(latestPoint.totalLiquidityUsd) : 'Unavailable', latestPoint?.date ?? 'Unavailable', change7 ? formatSignedPercent(change7.changePct) : 'Insufficient consecutive dates', change30 ? formatSignedPercent(change30.changePct) : 'Insufficient consecutive dates'];
  }), sourceFailureText('defillama-near-protocol-tvls') || 'No selected dated history rows returned.');
}

function selectedFlightSample() {
  const history = state.observations ?? [];
  const latestHeight = state.block?.height ?? history.at(-1)?.height ?? null;
  let height = state.flightRecorderHeight ?? latestHeight;
  if (height !== null && height !== latestHeight && !history.some((row) => row.height === height)) height = latestHeight;
  state.flightRecorderHeight = height;
  const observation = history.find((row) => row.height === height) ?? null;
  if (state.block?.height === height) {
    const activity = state.blockActivity?.blockHeight === height ? state.blockActivity : null;
    return { block: state.block, activity, observation, execution: summarizeShardExecution(state.block, activity), observedAt: observation?.observedAt ?? state.block.fetchedAt ?? null };
  }
  const block = observation ? summarizeBlock(observation.rawBlock, Date.parse(observation.observedAt)) : null;
  const activity = block ? summarizeBlockTransactions(block, observation.rawChunks) : null;
  return { block, activity, observation, execution: summarizeShardExecution(block, activity), observedAt: observation?.observedAt ?? block?.fetchedAt ?? null };
}

function flightRecorderModel() {
  const tvlRows = fullDayUsdRows(state.tvlHistory?.rows, 'tvl', 'date', 's').map((row) => ({ ...row, tvlUsd: row.valueUsd }));
  const dexRows = fullDayUsdRows(state.dexVolumeHistory?.rows);
  const feeRows = fullDayUsdRows(state.feeHistory?.rows);
  return {
    selected: selectedFlightSample(), tvlRows, dexRows, feeRows,
    latestDex: dexRows.at(-1) ?? null, latestFee: feeRows.at(-1) ?? null, latestTvl: tvlRows.at(-1) ?? null,
    dex7d: completeWindowSumChange(dexRows, 'valueUsd', 7),
    fees7d: completeWindowSumChange(feeRows, 'valueUsd', 7),
    tvl7d: windowChange(tvlRows, 'tvlUsd', 7), tvl30d: windowChange(tvlRows, 'tvlUsd', 30),
    turnover: summarizeWeeklyTurnoverIntensity(tvlRows, dexRows, 7),
    protocolConcentration: summarizeIndexedProtocolConcentration(state.nearProtocolTvls?.indexProtocols ?? []),
    stablecoins: summarizeStablecoinExposure(state.nearStablecoins?.assets ?? []),
  };
}

function renderFlightRecorder() {
  const model = flightRecorderModel(), history = (state.observations ?? []).slice().sort((a, b) => b.height - a.height);
  const currentHeight = state.block?.height ?? history[0]?.height ?? null;
  const options = new Map();
  if (state.block) options.set(state.block.height, { height: state.block.height, timestamp: state.block.timestamp, tx: state.blockActivity?.blockHeight === state.block.height ? state.blockActivity.transactionCount : null });
  for (const row of history) if (!options.has(row.height)) options.set(row.height, { height: row.height, timestamp: row.blockTime, tx: row.transactionCount });
  $('#flightSampleSelect').innerHTML = [...options.values()].map((row) => `<option value="${row.height}">Block ${compact(row.height, 0)} · ${row.tx === null || row.tx === undefined ? 'transaction sample unavailable' : `${compact(row.tx, 0)} verified transactions`} · ${escapeHtml(row.timestamp ?? 'time unavailable')}</option>`).join('') || '<option value="">No recorded finalized block</option>';
  if (currentHeight !== null && [...options.keys()].includes(model.selected?.block?.height)) $('#flightSampleSelect').value = String(model.selected.block.height);
  const sample = model.selected.execution, sampleSourceFailure = sourceFailureText('near-rpc-finalized');
  $('#flightRecorderStatus').textContent = sample ? model.selected.block?.finality === 'final' ? 'Finalized RPC sample' : 'Replayed finalized sample' : unavailableOrWaiting('near-rpc-finalized', 'Waiting for a verified block');
  $('#flightRecorderStatus').className = `status-pill ${sample ? 'good' : 'warn'}`;
  $('#flightBlockHeight').textContent = sample ? compact(sample.blockHeight, 0) : unavailableOrWaiting('near-rpc-finalized', 'Waiting for block');
  $('#flightSampleMeta').textContent = sample ? `Block ${compact(sample.blockHeight, 0)} · ${utcDateTime(sample.blockTimestamp)} · ${model.selected.observedAt ? `recorded ${ago(model.selected.observedAt)}` : 'observation time unavailable'}${sampleSourceFailure ? ` · latest RPC warning: ${sampleSourceFailure}` : ''}` : sampleSourceFailure || 'Waiting for a finalized block and shard data.';
  $('#flightShardStatus').textContent = sample?.transactionSampleVerified ? 'All shard chunks verified' : sample ? 'Gas only · transactions withheld' : 'Waiting for exact block';
  $('#flightShardStatus').className = `status-pill ${sample?.transactionSampleVerified ? 'good' : 'warn'}`;
  $('#flightSampleTx').textContent = sample?.transactionSampleVerified ? compact(sample.totalTransactions, 0) : unavailableOrWaiting('fastnear-neardata-block-transactions', 'Awaiting exact-height chunk match');
  $('#flightSampleTxFoot').textContent = sample?.transactionSampleVerified ? `${sample.includedTransactionChunks} newly included chunks · ${sample.reusedShardCount} earlier-height references counted as zero · ${utcDateTime(model.selected.activity?.fetchedAt ?? model.selected.observation?.transactionFetchedAt)}` : sourceFailureText('fastnear-neardata-block-transactions') || 'No complete matching transaction arrays retained for this block; no count inferred.';
  $('#flightShardLoad').textContent = sample ? `${sample.usedShards} / ${sample.shardCount}` : unavailableOrWaiting('near-rpc-finalized', 'Waiting for block');
  $('#flightShardLoadFoot').textContent = sample ? 'Shards with non-zero reported block gas / all shard rows' : sampleSourceFailure || 'Waiting for finalized block shard data.';
  $('#flightGasTgas').textContent = sample ? `${sample.totalGasTgas.toFixed(2)} Tgas` : unavailableOrWaiting('near-rpc-finalized', 'Waiting for block');
  $('#flightGasFoot').textContent = sample ? `Reported block gas across ${sample.shardCount} shard rows · not an application throughput measure` : sampleSourceFailure || 'Waiting for finalized block gas.';

  const shardRows = sample?.shards ?? [];
  $('#flightShardChart').innerHTML = shardRows.length ? shardRows.map((row) => {
    const gasShare = row.gasSharePct === null ? null : Math.max(0, Math.min(100, row.gasSharePct));
    const txShare = row.transactionSharePct === null ? null : Math.max(0, Math.min(100, row.transactionSharePct));
    const bar = (label, value, className) => `<div class="shard-bar-row"><span class="shard-bar-label">${label}</span><div class="shard-bar-track" aria-hidden="true"><span class="${className}" style="width:${value === null ? 0 : value.toFixed(2)}%"></span></div><span class="shard-bar-value">${value === null ? 'Unavailable' : `${value.toFixed(1)}%`}</span></div>`;
    return `<div class="shard-fingerprint-row"><div class="shard-fingerprint-head"><strong>Shard ${row.shardId}</strong><span>${row.gasTgas.toFixed(3)} Tgas · ${row.transactionCount === null ? 'tx unavailable' : `${compact(row.transactionCount, 0)} tx`}</span></div>${bar('Gas', gasShare, 'gas-share')}${bar('Tx', txShare, 'transaction-share')}</div>`;
  }).join('') : '<div class="chart-empty">No shard gas rows are available for this selection.</div>';
  $('#flightShardChart').setAttribute('aria-label', sample ? `Selected block ${sample.blockHeight} per-shard gas and transaction-share comparison` : 'No finalized block shard composition available');
  renderSimpleTable('#flightShardTable', 'Per-shard composition in the selected finalized block', ['Shard', 'Gas · Tgas', 'Gas-limit utilization', 'Gas share', 'Verified tx count', 'Tx share', 'Tx share − gas share'], shardRows.map((row) => [row.shardId, row.gasTgas.toFixed(3), Number.isFinite(row.gasUtilizationPct) ? `${row.gasUtilizationPct.toFixed(1)}%` : 'Unavailable', row.gasSharePct === null ? 'Unavailable' : `${row.gasSharePct.toFixed(1)}%`, row.transactionCount === null ? 'Unavailable' : compact(row.transactionCount, 0), row.transactionSharePct === null ? 'Unavailable' : `${row.transactionSharePct.toFixed(1)}%`, row.transactionMinusGasSharePp === null ? 'Unavailable' : `${row.transactionMinusGasSharePp > 0 ? '+' : ''}${row.transactionMinusGasSharePp.toFixed(1)} pp`]), sample ? 'No shard gas rows were returned.' : 'Waiting for selected finalized block data.');
  $('#flightShardScope').textContent = sample?.transactionSampleVerified ? `Transaction and gas shares are within block ${compact(sample.blockHeight, 0)} only. A positive gap means the shard’s share of this one transaction sample exceeds its share of reported block gas; it says nothing about unique users, retention or sustained load.` : 'Per-shard gas is available from the finalized-block RPC. Transaction counts and share differences remain unavailable until every shard chunk is verified against the exact block hash and inclusion height.';

  $('#flightDex7d').textContent = model.dex7d ? shortUsd(model.dex7d.current.sum) : unavailableOrWaiting('defillama-near-dex-volume', 'Waiting for 7 consecutive full days');
  $('#flightDexChange').textContent = model.dex7d ? formatSignedPercent(model.dex7d.changePct) : unavailableOrWaiting('defillama-near-dex-volume', 'Waiting for 14 consecutive full days');
  $('#flightDexFoot').textContent = model.dex7d ? `${model.dex7d.current.startDate}–${model.dex7d.current.endDate} vs ${model.dex7d.previous.startDate}–${model.dex7d.previous.endDate} · provider-indexed turnover` : 'Seven-day sums compared only when 14 consecutive dates are present.';
  $('#flightFees7d').textContent = model.fees7d ? shortUsd(model.fees7d.current.sum) : unavailableOrWaiting('defillama-near-fees', 'Waiting for 7 consecutive full days');
  $('#flightFeesChange').textContent = model.fees7d ? formatSignedPercent(model.fees7d.changePct) : unavailableOrWaiting('defillama-near-fees', 'Waiting for 14 consecutive full days');
  $('#flightFeesFoot').textContent = model.fees7d ? `${model.fees7d.current.startDate}–${model.fees7d.current.endDate} vs ${model.fees7d.previous.startDate}–${model.fees7d.previous.endDate} · indexed fee observations` : 'Provider-indexed fees, not a reconciled receipt-level ledger.';
  $('#flightTurnover').textContent = model.turnover ? `${model.turnover.turnoverPct.toFixed(2)}%` : unavailableOrWaiting(['defillama-tvl', 'defillama-near-dex-volume'], 'Waiting for 7 exact matched dates');
  $('#flightTurnoverFoot').textContent = model.turnover ? `7-day DEX notional ÷ mean daily TVL · ${model.turnover.startDate}–${model.turnover.endDate}. Descriptive intensity, not net flow.` : 'Requires seven consecutive UTC dates with both TVL and DEX observations; no date is filled.';

  $('#flightTvl7d').textContent = model.tvl7d ? formatSignedPercent(model.tvl7d.changePct) : unavailableOrWaiting('defillama-tvl', 'Waiting for 8 consecutive daily stocks');
  $('#flightTvl30d').textContent = model.tvl30d ? formatSignedPercent(model.tvl30d.changePct) : unavailableOrWaiting('defillama-tvl', 'Waiting for 31 consecutive daily stocks');
  $('#flightTvlFoot').textContent = model.tvlRows.length ? `${model.latestTvl?.date ?? 'Latest date unavailable'} UTC · reported USD stock; price and coverage effects remain` : sourceFailureText('defillama-tvl') || 'No valid dated TVL row.';
  const concentration = model.protocolConcentration;
  $('#flightIndexTop3').textContent = concentration ? `${concentration.topThreeSharePct.toFixed(1)}%` : unavailableOrWaiting('defillama-near-protocol-tvls', 'Waiting for eligible index rows');
  $('#flightIndexFoot').textContent = concentration ? `Top three of ${concentration.protocolCount} valid positive rows · HHI ${concentration.hhi.toFixed(0)} · ${shortUsd(concentration.totalIndexedTvlUsd)} indexed TVL · filtered provider universe, not full ecosystem.` : sourceFailureText('defillama-near-protocol-tvls') || 'No valid provider index values.';
  const stablecoins = model.stablecoins, peg = stablecoins?.largestQuoteDeviation;
  $('#flightStablecoinTotal').textContent = stablecoins ? shortUsd(stablecoins.totalCirculationUsd) : unavailableOrWaiting('defillama-near-stablecoins', 'Waiting for valid USD-pegged supply rows');
  $('#flightStablecoinFoot').textContent = peg ? `${stablecoins.assetCount} quoted assets · largest deviation: ${peg.symbol || peg.name} ${peg.deviationPct.toFixed(2)}% from $1 (reported ${shortUsd(peg.circulationUsd)} NEAR circulation); quote is not redemption or reserve proof.` : sourceFailureText('defillama-near-stablecoins') || 'No valid timestamped quote/circulation pair; provider does not expose a quote time.';
  $('#flightMarket').textContent = state.market ? `${usd(state.market.priceUsd, state.market.priceUsd < 1 ? 4 : 2)} · ${formatSignedPercent(state.market.priceChange24hPct, 2)}` : unavailableOrWaiting('coingecko-market', 'Waiting for timestamped market snapshot');
  $('#flightMarketFoot').textContent = state.market?.timestamp ? `CoinGecko provider time ${utcDateTime(state.market.timestamp)} · external market context, not on-chain flow.` : sourceFailureText('coingecko-market') || 'No timestamped market observation.';

  const validators = state.validators;
  $('#flightValidatorSet').textContent = validators ? `${compact(validators.validatorCount, 0)} current` : unavailableOrWaiting('near-rpc-validators', 'Waiting for validator snapshot');
  $('#flightValidatorFoot').textContent = validators ? `Top-10 active-set share ${Number.isFinite(validators.top10SharePct) ? `${validators.top10SharePct.toFixed(1)}%` : 'unavailable'} · HHI ${Number.isFinite(validators.hhi) ? validators.hhi.toFixed(0) : 'unavailable'} · ${validators.nextSetAddedCount ?? '—'} added / ${validators.nextSetRemovedCount ?? '—'} removed for next set.` : sourceFailureText('near-rpc-validators') || 'No current validator set.';
  $('#flightValidatorProduction').textContent = validators?.blockProductionPct === null || !validators ? unavailableOrWaiting('near-rpc-validators', 'Unavailable') : `${validators.blockProductionPct.toFixed(1)}% blocks`;
  $('#flightValidatorProductionFoot').textContent = validators ? `Current-epoch RPC counters · ${validators.prevEpochKickouts?.length ?? 0} previous-epoch kickouts · ${validators.slashedValidatorCount ?? 0} current slashing flags.` : sourceFailureText('near-rpc-validators') || 'No current epoch counters.';

  const historyRows = history.slice(0, 12).map((row) => [compact(row.height, 0), row.blockTime ? utcDateTime(row.blockTime) : 'Unavailable', Number.isFinite(row.gasTgas) ? `${row.gasTgas.toFixed(2)} Tgas` : 'Unavailable', row.transactionCount === null || row.transactionCount === undefined ? 'Unavailable' : compact(row.transactionCount, 0), row.transactionSampleVerified ? 'Exact-height matched' : 'Gas only / incomplete']);
  renderSimpleTable('#flightHistoryTable', 'Recent browser-local finalized block observations', ['Block', 'Finalized block time', 'Gas', 'Verified tx count', 'Evidence state'], historyRows, 'No locally recorded finalized-block observations yet. History starts only while this browser is open.');
  $('#flightHistorySpan').textContent = history.length ? `${history.length} browser-local raw-backed samples · most recent first · capped at ${MAX_LOCAL_OBSERVATIONS}; not an archive` : 'No locally recorded block samples.';

  const sourceIds = ['near-rpc-finalized', 'fastnear-neardata-block-transactions', 'near-rpc-validators', 'defillama-near-dex-volume', 'defillama-near-fees', 'defillama-tvl', 'defillama-near-protocol-tvls', 'defillama-near-stablecoins', 'coingecko-market'];
  const sourceRows = sourceIds.map((id) => {
    const source = DATA_SOURCES.find((item) => item.id === id), status = state.sourceStatuses.get(id);
    const available = ({ 'near-rpc-finalized': Boolean(state.block), 'fastnear-neardata-block-transactions': Boolean(state.blockActivity), 'near-rpc-validators': Boolean(state.validators), 'defillama-near-dex-volume': Boolean(state.dexVolumeHistory?.rows?.length), 'defillama-near-fees': Boolean(state.feeHistory?.rows?.length), 'defillama-tvl': Boolean(state.tvlHistory?.rows?.length), 'defillama-near-protocol-tvls': Boolean(state.nearProtocolTvls?.indexProtocols?.length), 'defillama-near-stablecoins': Boolean(state.nearStablecoins?.assets?.length), 'coingecko-market': Boolean(state.market) })[id];
    return [`<a href="${escapeHtml(source?.docUrl || source?.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(source?.name || id)}</a>`, feedStateLabel(id, available), status?.providerAt ? utcDateTime(status.providerAt) : status?.checkedAt ? `Checked ${utcDateTime(status.checkedAt)}` : 'Not checked'];
  });
  const sourceTable = $('#flightSourceTable');
  if (sourceTable) sourceTable.innerHTML = sourceRows.length ? `<table class="data-table"><caption class="sr-only">Flight Recorder source freshness</caption><thead><tr><th scope="col">Feed</th><th scope="col">State</th><th scope="col">Provider / check time</th></tr></thead><tbody>${sourceRows.map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="chart-empty">No source records.</div>';
  $('#flightRecipeSummary').textContent = CHART_QUERY_RECIPES.flightRecorder.plainLanguage;
  $('#flightRecipeText').textContent = CHART_QUERY_RECIPES.flightRecorder.query;
  $('#flightLimitations').innerHTML = CHART_QUERY_RECIPES.flightRecorder.limitations.map((line) => `<li>${escapeHtml(line)}</li>`).join('');

  const statements = [];
  statements.push(sample?.transactionSampleVerified ? `Block ${compact(sample.blockHeight, 0)} contains ${compact(sample.totalTransactions, 0)} verified transactions over ${sample.shardCount} shard rows in this exact sample.` : sample ? `Block ${compact(sample.blockHeight, 0)} has ${sample.shardCount} reported shard-gas rows, but its transaction payload is not fully verified.` : 'Waiting for a finalized execution sample.');
  statements.push(model.dex7d ? `The latest complete DEX window totals ${shortUsd(model.dex7d.current.sum)} (${formatSignedPercent(model.dex7d.changePct)} vs the prior seven days).` : 'DEX seven-day comparison is withheld until 14 consecutive full daily points are available.');
  statements.push(model.tvl7d ? `Reported NEAR DeFi TVL changed ${formatSignedPercent(model.tvl7d.changePct)} over ${model.tvl7d.days} days.` : 'TVL endpoint change is withheld until a complete consecutive daily window is available.');
  statements.push('Block samples, rolling provider series, market quotes and validator snapshots are distinct scopes/times; they are not collapsed into a health score or treated as causal evidence.');
  $('#flightRecorderReadout').innerHTML = statements.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

function exportFlightRecorder() {
  const model = flightRecorderModel(), selected = model.selected;
  if (!selected.execution) { announce('No finalized block sample is available to export yet.'); return; }
  const sourceIds = ['near-rpc-finalized', 'fastnear-neardata-block-transactions', 'near-rpc-validators', 'defillama-near-dex-volume', 'defillama-near-fees', 'defillama-tvl', 'defillama-near-protocol-tvls', 'defillama-near-stablecoins', 'coingecko-market'];
  const bundle = {
    product: 'NEAR SIGNAL', feature: 'NEAR Ecosystem Flight Recorder', version: 1, exportedAt: new Date().toISOString(),
    selectedBlock: { execution: selected.execution, observedAt: selected.observedAt, rawBlock: selected.block?.raw ?? selected.observation?.rawBlock ?? null, rawMatchedTransactionChunks: selected.observation?.rawChunks ?? selected.activity?.rawChunks ?? null, transactionFetchedAt: selected.activity?.fetchedAt ?? selected.observation?.transactionFetchedAt ?? null },
    currentContext: {
      dailyTvlRows: model.tvlRows, dailyDexRows: model.dexRows, dailyIndexedFeeRows: model.feeRows,
      nearProtocolIndex: state.nearProtocolTvls?.indexProtocols ?? null, nearStablecoins: state.nearStablecoins ?? null,
      currentValidatorSet: state.validators ?? null, currentMarket: state.market ?? null,
      derived: { dex7d: model.dex7d, fees7d: model.fees7d, tvl7d: model.tvl7d, tvl30d: model.tvl30d, weeklyTurnoverIntensity: model.turnover, indexedProtocolConcentration: model.protocolConcentration, stablecoinExposure: model.stablecoins },
      timeAlignment: 'Current context snapshots/rolling provider windows are exported separately from the selected block sample; they are not asserted to be synchronized to that block time.',
    },
    sourceStatuses: sourceIds.map((sourceId) => state.sourceStatuses.get(sourceId) ?? { sourceId, ok: null, checkedAt: null, providerAt: null, detail: 'No completed source check is available.' }),
    recipe: CHART_QUERY_RECIPES.flightRecorder,
    localRpcObservationHistory: state.observations,
    rawInputs: { rawTvlRows: state.tvlHistory?.rows ?? null, rawNearDexVolumeRows: state.dexVolumeHistory?.rows ?? null, rawNearFeeRows: state.feeHistory?.rows ?? null },
    limitations: CHART_QUERY_RECIPES.flightRecorder.limitations,
  };
  bundle.replayed = replayChartInputs({ exportedAt: bundle.exportedAt, rawTvlRows: bundle.rawInputs.rawTvlRows ?? [], rawNearDexVolumeRows: bundle.rawInputs.rawNearDexVolumeRows ?? [], rawNearFeeRows: bundle.rawInputs.rawNearFeeRows ?? [], localRpcObservationHistory: bundle.localRpcObservationHistory });
  downloadFile('near-signal-flight-recorder.json', JSON.stringify(bundle, null, 2), 'application/json');
  announce('Flight Recorder state, raw inputs, source status and offline replay outputs exported.');
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
    const stateText = status?.ok === true ? sourceIsStale(status) ? 'responding; last provider observation is stale' : 'responding' : status?.ok === false ? dataAvailableFor(sourceId) ? sourceIsStale(status) ? 'latest request failed; retained observation is stale' : 'latest request failed; previous data retained' : 'no successful response yet' : 'checking';
    return `${source?.name ?? sourceId}: ${stateText}${providerAt ? ` · provider time ${utcDateTime(providerAt)}` : ''}${fetchedAt ? ` · fetched ${utcDateTime(fetchedAt)}` : ''}`;
  });
  $('#thesisSourceStatus').innerHTML = observations.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  $('#thesisPlainLanguage').textContent = THESIS_TEST_RECIPE.plainLanguage;
  $('#thesisSourceQuery').textContent = THESIS_TEST_RECIPE.query;
  $('#thesisMethodList').innerHTML = THESIS_TEST_RECIPE.method.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  $('#thesisLimitations').innerHTML = THESIS_TEST_RECIPE.limitations.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}
function dataAvailableFor(sourceId) {
  return ({ 'near-rpc-finalized': Boolean(state.block), 'near-rpc-protocol-config': Boolean(state.protocolConfig), 'fastnear-neardata-block-transactions': Boolean(state.blockActivity), 'near-rpc-status': Boolean(state.rpcStatus), 'near-rpc-validators': Boolean(state.validators), 'coingecko-market': Boolean(state.market), 'coingecko-history': Boolean(state.marketChart), 'defillama-price': Boolean(state.llamaPrice), 'defillama-tvl': Boolean(state.tvlHistory?.rows?.length), 'defillama-near-protocol-tvls': Boolean(state.nearProtocolTvls?.protocols?.length || state.nearProtocolTvls?.indexProtocols?.length), 'defillama-near-stablecoins': Boolean(state.nearStablecoins?.assets?.length), 'defillama-near-dex-volume': Boolean(state.dexVolumeHistory?.rows?.length), 'defillama-near-fees': Boolean(state.feeHistory?.rows?.length), 'geckoterminal-near-pools': Boolean(state.nearPoolSnapshot?.pools?.length) })[sourceId] ?? false;
}
function renderAll() {
  const renderers = {
    overview: renderOverview,
    'value-capture': renderValueCapture,
    adoption: renderParticipation,
    'risk-radar': renderRisks,
    'capital-flows': renderCapital,
    'flight-recorder': renderFlightRecorder,
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
      status.lastDataAt ??= previous?.lastDataAt ?? previous?.providerAt ?? previous?.lastProviderAt ?? previous?.checkedAt ?? null;
      const failures = (state.failureCounts.get(field) || 0) + 1;
      state.failureCounts.set(field, failures);
      const baseDelay = field === 'block' ? 30_000 : 60_000;
      const delay = Math.min(30 * 60_000, baseDelay * 2 ** Math.min(failures - 1, 5));
      const retryAt = Date.now() + delay;
      state.retryAt.set(field, retryAt);
      status.retryAt = new Date(retryAt).toISOString();
    } else if (status?.ok) {
      status.lastDataAt = status.providerAt ?? status.checkedAt ?? new Date().toISOString();
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
    const configFetchedAt = Date.parse(state.protocolConfig?.fetchedAt ?? '');
    if (block && (state.protocolConfig?.protocolVersion !== block.protocolVersion || !Number.isFinite(configFetchedAt) || Date.now() - configFetchedAt >= PROTOCOL_CONFIG_INTERVAL_MS)) {
      await fetchAndApply('protocolConfig', () => fetchProtocolConfig(block));
    }
    renderAll();
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
async function refreshDatedAnalytics() {
  const [dexResult, feeResult] = await Promise.all([
    fetchAndApply('dexVolumeHistory', fetchNearDexVolumeHistory),
    fetchAndApply('feeHistory', fetchNearFeesHistory),
  ]);
  renderAll();
  return Boolean(dexResult?.status?.ok && feeResult?.status?.ok);
}
async function refreshPoolSnapshot() { const result = await fetchAndApply('nearPoolSnapshot', fetchNearPoolSnapshot); renderAll(); return result; }
async function refreshRiskFeeds() {
  const [protocolResult, stablecoinResult] = await Promise.all([
    fetchAndApply('nearProtocolTvls', fetchNearProtocolTvls),
    fetchAndApply('nearStablecoins', fetchNearStablecoins),
  ]);
  renderAll();
  return Boolean(protocolResult?.status?.ok && stablecoinResult?.status?.ok);
}
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
    const fetchThenRender = async (field, fetcher) => {
      const result = await fetchAndApply(field, fetcher);
      renderAll();
      return result;
    };
    await Promise.all([
      refreshBlock(), fetchThenRender('llamaPrice', fetchDefiLlamaPrice),
      fetchThenRender('tvlHistory', fetchTvlHistory), fetchThenRender('market', fetchCoinGeckoMarket),
      fetchThenRender('marketChart', fetchCoinGeckoHistory),
      fetchThenRender('nearProtocolTvls', fetchNearProtocolTvls), fetchThenRender('nearStablecoins', fetchNearStablecoins),
      fetchThenRender('dexVolumeHistory', fetchNearDexVolumeHistory), fetchThenRender('feeHistory', fetchNearFeesHistory),
      fetchThenRender('nearPoolSnapshot', fetchNearPoolSnapshot),
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
    await Promise.all([refreshDefiPrice(), refreshTvl(), refreshRiskFeeds(), refreshDatedAnalytics(), refreshPoolSnapshot()]);
    await refreshSlowRpc();
    if (Date.now() - state.lastMarketRefresh >= MARKET_MANUAL_COOLDOWN_MS) await refreshCoinGecko();
    else $('#marketPriceFoot').textContent = `CoinGecko manual refresh cooldown; current snapshot from ${state.market?.timestamp ? utcDateTime(state.market.timestamp) : 'unavailable'}.`;
  } finally { state.isRefreshing = false; button.disabled = false; button.innerHTML = '↻ <span>Refresh</span>'; renderAll(); announce('Available signals refreshed. Transaction samples respect a five-minute cadence, GeckoTerminal a five-minute cadence, and CoinGecko a one-minute cooldown. See source status for failed reads.'); }
}
function exportEvidence() {
  const flight = flightRecorderModel();
  const bundle = {
    project: 'NEAR SIGNAL', exportedAt: new Date().toISOString(), status: 'public read-only Vercel dashboard; hackathon submission not made',
    live: { market: state.market, independentSpotPrice: state.llamaPrice, finalizedBlock: state.block, blockMatchedProtocolConfig: state.protocolConfig, sampledFinalizedBlockTransactions: state.blockActivity,
      rpcStatus: state.rpcStatus ? { chainId: state.rpcStatus.chain_id, syncing: state.rpcStatus.syncing, latestBlockHeight: state.rpcStatus.sync_info?.latest_block_height, latestBlockTime: state.rpcStatus.sync_info?.latest_block_time } : null,
      currentValidatorSet: state.validators, nearProtocolTvls: state.nearProtocolTvls, nearStablecoins: state.nearStablecoins,
      nearDexVolumeHistory: state.dexVolumeHistory, nearFeeHistory: state.feeHistory, nearPoolSnapshot: state.nearPoolSnapshot },
    flightRecorder: { selectedBlock: flight.selected.execution, selectedBlockObservedAt: flight.selected.observedAt, currentContext: { dex7d: flight.dex7d, fees7d: flight.fees7d, tvl7d: flight.tvl7d, tvl30d: flight.tvl30d, weeklyTurnoverIntensity: flight.turnover, indexedProtocolConcentration: flight.protocolConcentration, stablecoinExposure: flight.stablecoins }, recipe: CHART_QUERY_RECIPES.flightRecorder, note: 'The selected block sample is separate from current rolling economic and market observations; no synchronization or composite score is inferred.' },
    dailyAlignedMarketAndTvl: allDailyRows(), dailyHypothesisSeries: hypothesisRows(), rawTvlRows: state.tvlHistory?.rows ?? null, rawCoinGeckoMarketChart: state.marketChart,
    rawNearDexVolumeRows: state.dexVolumeHistory?.rows ?? null, rawNearFeeRows: state.feeHistory?.rows ?? null, rawNearPoolSnapshot: state.nearPoolSnapshot ?? null,
    localRpcObservationHistory: state.observations, localStablecoinPriceObservations: state.stablecoinObservations,
    chartSelections: { days: state.days, metric: state.chartMetric, capitalDays: Number($('#capitalWindowSelect').value), flightRecorderHeight: flight.selected.block?.height ?? null },
    onDemandAccountInspection: accountInspection,
    executionCostScenario: { gasTgas: Number($('#feeGasInput').value), gasPriceNearPerTgas: state.block?.gasPriceNearPerTgas ?? null, priceUsd: state.market?.priceUsd ?? state.llamaPrice?.priceUsd ?? null, estimate: estimateExecutionCost($('#feeGasInput').value, state.block?.gasPriceNearPerTgas, state.market?.priceUsd ?? state.llamaPrice?.priceUsd) },
    chartQueryRecipes: CHART_QUERY_RECIPES,
    thesisTestRecipe: THESIS_TEST_RECIPE,
    sourceRegistry: DATA_SOURCES.map((source) => ({ ...source, status: state.sourceStatuses.get(source.id) ?? null })),
    limitations: ['The sampled transaction count is for one finalized block and is not a daily series, unique-user count, retention measure or adoption trend.', 'Daily account cohorts, historical transaction trends and contract activity are unavailable; no such metrics are inferred from a block sample.', 'No canonical, deduplicated Intents or bridge net-flow history is connected.', 'Market volume is gross exchange activity; TVL is a USD stock; neither is net investment.', 'DEX volume is turnover, not net flow; GeckoTerminal page 1 is a bounded pool snapshot, not every NEAR pool or chain-wide liquidity.', 'DefiLlama indexed fee data is not a reconciled receipt-level fee ledger, realized protocol revenue, validator income or APY.', 'Block gas multiplied by gas price is an execution-value proxy, not exact signer debit, total fees burned or revenue; the protocol rule is shown separately.', 'The protocol-index universe is provider coverage with a $100,000 threshold; detailed history reads cover at most eight selected records.', 'The hypothesis calculation is descriptive correlation only; it does not establish causation or statistical significance.', 'Local RPC observation history only accrues while this browser is open and is not a chain archive.'],
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
  const gasFailure = sourceFailureText('near-rpc-finalized');
  $('#feeEstimateNear').textContent = result ? `${result.near.toFixed(6)} Ⓝ` : unavailableOrWaiting('near-rpc-finalized', 'Waiting for live gas price');
  $('#feeEstimateUsd').textContent = result?.usd !== null && result?.usd !== undefined ? usd(result.usd, 6) : unavailableOrWaiting(['coingecko-market', 'defillama-price'], 'Waiting for timestamped market price');
  $('#feeEstimateSource').textContent = state.block ? `Block ${state.block.height} · ${utcDateTime(state.block.timestamp)} · ${state.block.gasPriceNearPerTgas.toFixed(6)} Ⓝ/Tgas${gasFailure ? ` · latest read failed; prior value retained: ${gasFailure}` : ''}` : gasFailure || 'Waiting for live gas price';
  $('#feeCalculatorStatus').textContent = result ? (gasFailure ? 'Retained gas price' : 'Live gas price') : gasFailure ? 'Gas source unavailable' : state.block ? 'Check gas budget' : 'Needs live gas price';
  $('#feeCalculatorFeedback').textContent = result ? `${result.gasTgas} Tgas × ${gasFailure ? 'retained' : 'latest'} block gas price.${gasFailure ? ` Latest request failed: ${gasFailure}.` : ''} USD equivalent uses a separately timestamped market price; storage and other charges are excluded.` : gasFailure ? `Gas estimate unavailable because the finalized-block read failed: ${gasFailure}` : 'Enter a budget above 0 and no greater than 300 Tgas. A live gas price is required.';
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
  $('#capitalWindowSelect').addEventListener('change', renderCapital);
  $('#flightSampleSelect').addEventListener('change', (event) => { state.flightRecorderHeight = event.target.value ? Number(event.target.value) : null; renderFlightRecorder(); });
  $('#flightExportButton').addEventListener('click', exportFlightRecorder);
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
setInterval(() => { void refreshRiskFeeds(); }, RISK_FEED_INTERVAL_MS);
setInterval(() => { void refreshDatedAnalytics(); }, FEE_HISTORY_INTERVAL_MS);
setInterval(() => { void refreshPoolSnapshot(); }, POOL_SNAPSHOT_INTERVAL_MS);
setInterval(() => { if (document.body.dataset.route === 'overview') renderBlockAge(); }, 1000);
setInterval(() => { if (document.body.dataset.route === 'risk-radar') renderRisks(); }, 10_000);
