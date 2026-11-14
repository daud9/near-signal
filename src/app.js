import { alignMarketAndTvl, assessLiveRisks, formatSignedPercent, testHypothesis, toUtcDate, windowChange } from './analytics.js';
import { DATA_SOURCES, fetchBlockTransactionCount, fetchCoinGeckoHistory, fetchCoinGeckoMarket, fetchDefiLlamaPrice, fetchFinalizedBlock, fetchRpcStatus, fetchTvlHistory, fetchValidatorSet } from './data.js';

const $ = (selector) => document.querySelector(selector);
const state = {
  market: null, marketChart: null, llamaPrice: null, tvlHistory: null, blockActivity: null,
  block: null, rpcStatus: null, validators: null, sourceStatuses: new Map(), observations: readObservations(),
  chartMetric: 'priceUsd', days: 14, declineThreshold: 20, isRefreshing: false, rpcBusy: false, lastMarketRefresh: 0, lastChunkRequestAt: 0,
  inFlight: new Set(), failureCounts: new Map(), retryAt: new Map(),
};
const METRICS = {
  priceUsd: { label: 'Daily NEAR price change', color: '#c8f27c', format: 'usd' },
  tvlUsd: { label: 'Daily NEAR DeFi TVL change', color: '#8bd3be', format: 'usd' },
  grossVolumeUsd: { label: 'Daily gross market-volume change', color: '#8ab9db', format: 'usd' },
};
const LOCAL_HISTORY_KEY = 'near-signal.rpc-observations.v1';
const MAX_LOCAL_OBSERVATIONS = 360;
const FAST_INTERVAL_MS = 60_000;
const BLOCK_TRANSACTION_INTERVAL_MS = 300_000;
const DEFI_PRICE_INTERVAL_MS = 120_000;
const SLOW_RPC_INTERVAL_MS = 300_000;
const TVL_INTERVAL_MS = 1_800_000;
const MARKET_MANUAL_COOLDOWN_MS = 60_000;
const FIELD_SOURCE_IDS = { block: 'near-rpc-finalized', blockActivity: 'near-rpc-block-transactions', rpcStatus: 'near-rpc-status', validators: 'near-rpc-validators', market: 'coingecko-market', marketChart: 'coingecko-history', llamaPrice: 'defillama-price', tvlHistory: 'defillama-tvl' };
const RISK_SOURCE_IDS = {
  concentration: ['near-rpc-validators'], adoption: ['near-rpc-block-transactions'],
  capital: ['defillama-tvl', 'coingecko-history'], infrastructure: ['near-rpc-finalized', 'near-rpc-status'],
  economics: ['coingecko-market', 'near-rpc-finalized'], dependencies: [],
};

function readObservations() {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter((row) => row && Number.isFinite(Number(row.height)) && Number.isFinite(Date.parse(row.observedAt))).slice(-MAX_LOCAL_OBSERVATIONS) : [];
  } catch { return []; }
}
function persistObservations() { try { localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(state.observations.slice(-MAX_LOCAL_OBSERVATIONS))); } catch { /* Browser storage may be disabled. */ } }
function mergeSourceStatus(status) { if (status?.sourceId) state.sourceStatuses.set(status.sourceId, status); }
function applyResult(field, result) { if (Object.hasOwn(result ?? {}, 'value')) state[field] = result.value; mergeSourceStatus(result?.status); }
function appendBlockObservation(block) {
  if (!block || !Number.isFinite(block.height)) return;
  const existingIndex = state.observations.findIndex((row) => row.height === block.height);
  if (existingIndex >= 0) {
    const existing = state.observations[existingIndex];
    if (!Number.isSafeInteger(block.transactionCount) || existing.transactionCount === block.transactionCount) return;
    state.observations[existingIndex] = { ...existing, transactionCount: block.transactionCount, transactionChunkCount: block.transactionChunkCount, transactionFetchedAt: block.transactionFetchedAt };
  } else {
    state.observations.push({ observedAt: new Date().toISOString(), height: block.height, blockTime: block.timestamp, gasUsed: block.gasUsed, estimatedGasFeeNear: block.estimatedGasFeeNear, activeChunks: block.activeChunks, transactionCount: Number.isSafeInteger(block.transactionCount) ? block.transactionCount : null, transactionChunkCount: block.transactionChunkCount ?? null, transactionFetchedAt: block.transactionFetchedAt ?? null });
  }
  state.observations = state.observations.slice(-MAX_LOCAL_OBSERVATIONS);
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
function renderLineChart(container, rows, metric, { label, color = '#c8f27c', format = 'usd', dateKey = 'date', emptyText = 'Waiting for observations', yLabel = null } = {}) {
  if (!container) return;
  const points = (rows ?? []).map((row) => ({ row, value: valueForChart(metric, row), date: row?.[dateKey] })).filter((point) => point.value !== null && point.date);
  if (points.length < 2) { container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyText)}</div>`; return; }
  const width = 720, height = 220, margin = { top: 12, right: 18, bottom: 34, left: 64 };
  const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  let minValue = Math.min(...points.map((point) => point.value)), maxValue = Math.max(...points.map((point) => point.value));
  if (minValue === maxValue) { const padding = Math.abs(minValue) * .04 || 1; minValue -= padding; maxValue += padding; }
  const padding = (maxValue - minValue) * .08; minValue -= padding; maxValue += padding;
  const utcTimes = dateKey === 'date' ? points.map((point) => Date.parse(`${String(point.date).slice(0, 10)}T00:00:00Z`)) : [];
  const firstMs = utcTimes[0], spanMs = utcTimes.at(-1) - firstMs;
  const useUtcSpacing = utcTimes.length === points.length && utcTimes.every(Number.isFinite) && spanMs > 0;
  const x = (index) => useUtcSpacing ? margin.left + (utcTimes[index] - firstMs) / spanMs * plotWidth : margin.left + index / (points.length - 1) * plotWidth;
  const y = (value) => margin.top + (maxValue - value) / (maxValue - minValue) * plotHeight;
  const gapBefore = (index) => useUtcSpacing && index > 0 && (utcTimes[index] - utcTimes[index - 1]) !== 86_400_000;
  const hasGap = points.some((_, index) => gapBefore(index));
  const path = points.map((point, index) => `${index && !gapBefore(index) ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const grid = [0, 1, 2, 3].map((index) => {
    const yy = margin.top + index / 3 * plotHeight, value = maxValue - index / 3 * (maxValue - minValue);
    return `<line x1="${margin.left}" y1="${yy.toFixed(1)}" x2="${width - margin.right}" y2="${yy.toFixed(1)}" stroke="#2b3730" stroke-width="1"/><text x="${margin.left - 8}" y="${(yy + 3).toFixed(1)}" fill="#86948a" text-anchor="end" font-size="9">${escapeHtml(chartLabel(value, format))}</text>`;
  }).join('');
  const firstDate = String(points[0].date).slice(0, 10), lastDate = String(points.at(-1).date).slice(0, 10);
  const area = hasGap ? '' : `${path} L${x(points.length - 1).toFixed(1)},${(height - margin.bottom).toFixed(1)} L${x(0).toFixed(1)},${(height - margin.bottom).toFixed(1)} Z`;
  const circles = points.map((point, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="2.2" fill="${color}"><title>${escapeHtml(String(point.date))}: ${escapeHtml(chartLabel(point.value, format))}</title></circle>`).join('');
  const tableRows = points.map((point) => {
    const exactDate = String(point.date);
    return `<tr><td><time datetime="${escapeHtml(exactDate)}">${escapeHtml(utcDateTime(exactDate))}</time></td><td>${escapeHtml(chartLabel(point.value, format))}</td></tr>`;
  }).join('');
  const table = `<details class="chart-data"><summary>View data table (${points.length} observations)</summary><div class="chart-table-wrap"><table><caption class="sr-only">${escapeHtml(label || 'Chart')} plotted observations</caption><thead><tr><th scope="col">Observed at (UTC)</th><th scope="col">${escapeHtml(label || 'Value')}</th></tr></thead><tbody>${tableRows}</tbody></table></div></details>`;
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label || 'Dated line chart')}"><title>${escapeHtml(label || 'Dated line chart')}</title><desc>${points.length} sourced observations from ${escapeHtml(firstDate)} to ${escapeHtml(lastDate)}; missing daily dates are visibly broken and no values are filled.</desc>${grid}${area ? `<path d="${area}" fill="${color}" opacity=".06"/>` : ''}<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${circles}<text x="${margin.left}" y="${height - 8}" fill="#86948a" font-size="9">${escapeHtml(firstDate)}</text><text x="${width - margin.right}" y="${height - 8}" fill="#86948a" text-anchor="end" font-size="9">${escapeHtml(lastDate)}</text><text x="${width - margin.right}" y="${margin.top + 10}" fill="#acb8ad" text-anchor="end" font-size="9">${escapeHtml(yLabel || label || '')}</text></svg>${table}`;
}

function updateHeader() {
  const connected = DATA_SOURCES.filter((source) => source.connected);
  const statuses = connected.map((source) => state.sourceStatuses.get(source.id)).filter((status) => status && status.ok !== null);
  const successes = statuses.filter((status) => status.ok).length, failures = statuses.filter((status) => status.ok === false).length;
  const stale = statuses.filter((status) => status.ok && sourceIsStale(status)).length;
  const pending = connected.length - statuses.length;
  const dot = $('#feedDot');
  if (pending > 0) {
    const parts = [];
    if (successes) parts.push(`${successes}/${connected.length} connected feeds responding`);
    if (failures) parts.push(`${failures} unavailable`);
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
    $('#feedStatus').textContent = 'Connected feeds unavailable';
    dot?.classList.add('bad'); dot?.classList.remove('ok');
  }
  const times = statuses.filter((status) => status.ok).map((status) => Date.parse(status.checkedAt)).filter(Number.isFinite);
  if (times.length) {
    const latest = new Date(Math.max(...times)).toISOString();
    $('#refreshTimestamp').textContent = `Latest request: ${utcDateTime(latest)}`;
    $('#sourceFreshness').textContent = `Most recent successful source check: ${ago(latest)} · ${utcDateTime(latest)}`;
    $('#footerFreshness').textContent = `Most recent successful source check: ${utcDateTime(latest)}`;
  }
}
function renderOverview() {
  const daily = allDailyRows(), marketFallback = !state.market && state.llamaPrice;
  const currentPrice = state.market?.priceUsd ?? state.llamaPrice?.priceUsd ?? null;
  $('#marketPrice').textContent = currentPrice === null ? 'Unavailable' : usd(currentPrice, currentPrice < 1 ? 4 : 2);
  $('#marketPriceFoot').textContent = state.market?.timestamp ? `CoinGecko provider time: ${utcDateTime(state.market.timestamp)} · fetched ${ago(state.market.fetchedAt)}` : marketFallback ? `DefiLlama fallback price · provider time ${utcDateTime(state.llamaPrice.timestamp)}` : 'CoinGecko market snapshot not available';
  $('#marketChange').textContent = state.market?.priceChange24hPct === null || state.market?.priceChange24hPct === undefined ? 'Unavailable' : formatSignedPercent(state.market.priceChange24hPct, 2);
  $('#marketChangeFoot').textContent = state.market?.timestamp ? `CoinGecko provider time: ${utcDateTime(state.market.timestamp)} · exchange-aggregated` : 'No current 24-hour change signal';
  $('#finalizedBlock').textContent = state.block ? compact(state.block.height, 0) : 'Unavailable';
  $('#finalizedBlockFoot').textContent = state.block ? `Finalized · block time ${utcDateTime(state.block.timestamp)} · fetched ${ago(state.block.fetchedAt)}` : 'No finalized block observation';
  renderBlockAge();
  const chartRows = daily.slice(-(state.days + 1)), metric = state.chartMetric, meta = METRICS[metric] || METRICS.priceUsd;
  renderLineChart($('#overviewChart'), chartRows, metric, { label: meta.label, color: meta.color, format: meta.format, emptyText: 'No matched dated series yet. Current live spot data is shown above; the chart requires matching daily price and TVL dates.' });
  $('#observedSpan').textContent = chartRows.length > 1 ? `${chartRows.length} matched dates · ${chartRows[0].date} to ${chartRows.at(-1).date}` : 'Waiting for matched daily observations';
  $('#dataAsOf').textContent = `Daily series through ${daily.at(-1)?.date ?? '—'} UTC`;
  $('#overviewChartSubtitle').textContent = `${meta.label}; matched UTC dates only, current partial UTC day excluded.`;
  const tvl7d = windowChange(daily, 'tvlUsd', 7), tvl30d = windowChange(daily, 'tvlUsd', 30);
  const dims = [
    ['Network execution', state.block ? 'Live block + gas observed' : 'Unavailable'],
    ['Per-block transactions', state.blockActivity ? 'All returned shard chunks counted' : 'Waiting for complete chunk sample'],
    ['Validator participation', state.validators ? 'Current active set observed' : 'Unavailable'],
    ['Market / TVL context', state.market && state.tvlHistory ? 'Live snapshot + daily history' : 'Partial / unavailable'],
    ['Daily accounts / retention', 'Not measured'],
    ['Net capital flows', 'Not measured'],
    ['Dependency / app concentration', 'Not measured'],
  ];
  $('#dimensionList').innerHTML = dims.map(([name, status]) => `<div class="dimension-row"><span>${escapeHtml(name)}</span><span class="dim-status">${escapeHtml(status)}</span></div>`).join('');
  const nodeSync = typeof state.rpcStatus?.syncing === 'boolean' ? (state.rpcStatus.syncing ? 'syncing' : 'not syncing') : 'not reported';
  const nodeHeight = state.rpcStatus?.sync_info?.latest_block_height ? ` · RPC node latest height ${compact(state.rpcStatus.sync_info.latest_block_height, 0)}` : '';
  const activityText = state.blockActivity ? ` Most recent sampled block ${compact(state.blockActivity.blockHeight, 0)} contains ${compact(state.blockActivity.transactionCount, 0)} transactions across ${state.blockActivity.chunkCount} shard chunks.` : ' No complete per-block transaction sample is available.';
  $('#liveSummary').textContent = state.block ? `Finalized block ${compact(state.block.height, 0)} · ${state.block.activeChunks}/${state.block.chunkCount} chunks used gas · ${state.block.gasUtilizationPct?.toFixed(2) ?? '—'}% of reported chunk gas limits.${activityText} RPC node reports ${nodeSync}${nodeHeight}.` : `No live finalized block returned. RPC node reports ${nodeSync}${nodeHeight}.`;
  $('#contextSummary').textContent = daily.length ? `${daily.length} complete matched daily dates; current UTC date excluded. TVL change: 7-day ${tvl7d ? formatSignedPercent(tvl7d.changePct) : 'unavailable'}, 30-day ${tvl30d ? formatSignedPercent(tvl30d.changePct) : 'unavailable'}.` : 'Historical market/TVL context is not yet matched to complete UTC dates.';
  $('#gapSummary').textContent = 'The sampled transaction count is block-local, not a daily series or user count. Account cohorts/retention, app diversity, net bridge/Intents flows, historical fees and dependency maps remain unavailable.';
}
function renderBlockAge() {
  if (!state.block) { $('#blockAge').textContent = 'Unavailable'; $('#blockAgeFoot').textContent = 'Waiting for NEAR mainnet RPC'; return; }
  const age = Math.max(0, (Date.now() - state.block.timestampMs) / 1000);
  $('#blockAge').textContent = `${age.toFixed(1)} sec`;
  $('#blockAgeFoot').textContent = `Finalized block time ${utcDateTime(state.block.timestamp)} · last fetched ${ago(state.block.fetchedAt)}`;
}
function renderValueCapture() {
  const block = state.block;
  $('#valueStatus').textContent = block ? 'Live block estimate' : 'Waiting for finalized block';
  $('#valueStatus').className = `status-pill ${block ? 'good' : 'warn'}`;
  $('#blockGasCost').textContent = block ? `${block.estimatedGasFeeNear.toFixed(6)} Ⓝ` : 'Unavailable';
  $('#blockGasUsed').textContent = block ? `${(block.gasUsed / 1e12).toFixed(2)} Tgas` : 'Unavailable';
  $('#blockGasUsedFoot').textContent = block ? `${block.activeChunks}/${block.chunkCount} returned chunks have non-zero gas used` : 'No finalized chunk data';
  $('#blockGasUtil').textContent = block?.gasUtilizationPct === null || !block ? 'Unavailable' : `${block.gasUtilizationPct.toFixed(2)}%`;
  $('#blockGasUtilFoot').textContent = block ? `Block ${compact(block.height, 0)} · ${utcDateTime(block.timestamp)}` : 'No finalized chunk data';
  $('#gasPrice').textContent = block ? `${block.gasPriceNearPerTgas.toFixed(6)} Ⓝ` : 'Unavailable';
  $('#marketCap').textContent = state.market?.marketCapUsd === null || state.market?.marketCapUsd === undefined ? 'Unavailable' : shortUsd(state.market.marketCapUsd);
  $('#grossVolume').textContent = state.market?.grossVolume24hUsd === null || state.market?.grossVolume24hUsd === undefined ? 'Unavailable' : shortUsd(state.market.grossVolume24hUsd);
  const coinGeckoTime = Date.parse(state.market?.timestamp ?? ''), llamaTime = Date.parse(state.llamaPrice?.timestamp ?? '');
  const bothSpotPrices = Number.isFinite(state.market?.priceUsd) && state.market.priceUsd > 0 && Number.isFinite(state.llamaPrice?.priceUsd) && state.llamaPrice.priceUsd > 0;
  const timestampsValid = Number.isFinite(coinGeckoTime) && Number.isFinite(llamaTime);
  const timestampGapMs = timestampsValid ? Math.abs(coinGeckoTime - llamaTime) : null;
  const spotGap = bothSpotPrices && timestampsValid && timestampGapMs <= 300_000 ? Math.abs(state.market.priceUsd - state.llamaPrice.priceUsd) / state.market.priceUsd * 100 : null;
  $('#spotDifference').textContent = spotGap === null ? (bothSpotPrices && timestampsValid ? 'Not time-matched' : 'Unavailable') : `${spotGap.toFixed(2)}%`;
  $('#marketCapTime').textContent = state.market?.timestamp ? `CoinGecko ${utcDateTime(state.market.timestamp)}` : 'No timestamped observation';
  $('#grossVolumeTime').textContent = state.market?.timestamp ? `CoinGecko ${utcDateTime(state.market.timestamp)}` : 'No timestamped observation';
  $('#spotDifferenceFoot').textContent = timestampsValid ? timestampGapMs <= 300_000 ? `CoinGecko ${utcDateTime(state.market.timestamp)} · DefiLlama ${utcDateTime(state.llamaPrice.timestamp)}` : `Not compared: provider timestamps differ by ${(timestampGapMs / 60_000).toFixed(1)} minutes` : 'Both timestamped spot feeds are required';
  const observations = state.observations.map((row) => ({ ...row, gasTgas: Number(row.gasUsed) / 1e12 }));
  renderLineChart($('#gasChart'), observations, 'gasTgas', { label: 'Gas used per sampled finalized block', color: '#8bd3be', format: 'tgas', dateKey: 'observedAt', emptyText: 'Collecting real finalized-block observations. No historical values are fabricated.' });
  $('#blockHistoryStatus').textContent = observations.length > 1 ? `${observations.length} local block observations` : 'Collecting observations';
  $('#blockHistorySpan').textContent = observations.length > 1 ? `${utcDateTime(observations[0].observedAt)} to ${utcDateTime(observations.at(-1).observedAt)}` : 'A local time series appears after multiple polls.';
}
function renderParticipation() {
  const validators = state.validators;
  const validatorStatus = state.sourceStatuses.get('near-rpc-validators');
  const validatorPlaceholder = validatorStatus ? 'Unavailable' : 'Checking';
  $('#validatorCount').textContent = validators ? compact(validators.validatorCount, 0) : validatorPlaceholder;
  $('#validatorEpoch').textContent = validators?.epochHeight === null || validators?.epochHeight === undefined ? validatorStatus ? 'Epoch unavailable' : 'Checking current epoch' : `Epoch height ${compact(validators.epochHeight, 0)} · ${validators.nextValidatorCount ?? '—'} next-set records`;
  $('#validatorTop10').textContent = validators ? `${validators.top10SharePct.toFixed(1)}%` : validatorPlaceholder;
  $('#validatorHhi').textContent = validators ? `Current-set stake HHI: ${validators.hhi.toFixed(0)}` : `${validatorPlaceholder} · no concentration estimate`;
  $('#validatorProduction').textContent = validators?.blockProductionPct === null || !validators ? validatorPlaceholder : `${validators.blockProductionPct.toFixed(1)}%`;
  $('#validatorProductionFoot').textContent = validators ? `${compact(validators.producedBlocks, 0)} produced / ${compact(validators.expectedBlocks, 0)} expected blocks in returned epoch counters` : validatorStatus ? 'Current epoch counters unavailable' : 'Checking current epoch counters';
  const activity = state.blockActivity;
  const sourceStatus = state.sourceStatuses.get('near-rpc-block-transactions');
  const activityPlaceholder = sourceStatus ? 'Unavailable' : 'Checking';
  $('#blockTxLatest').textContent = activity ? compact(activity.transactionCount, 0) : activityPlaceholder;
  $('#blockTxAsOf').textContent = activity ? `Finalized block ${compact(activity.blockHeight, 0)} · ${activity.chunkCount} shard chunks · ${utcDateTime(activity.blockTimestamp)}` : sourceStatus ? 'No complete all-shard count available' : 'Waiting for complete all-shard count';
  $('#blockTxChunks').textContent = activity ? compact(activity.chunkCount, 0) : activityPlaceholder;
  $('#blockTxFreshness').textContent = activity?.fetchedAt ? `Sampled ${ago(activity.fetchedAt)} · transaction identities are not retained.` : sourceStatus ? 'A complete finalized-block sample is unavailable.' : 'Requesting a complete finalized-block sample.';
  $('#activityStatus').textContent = activity ? (sourceStatus?.ok === false ? 'Last sample retained · latest read failed' : 'Live block count observed') : (sourceStatus?.ok === false ? 'Complete chunk sample unavailable' : 'Sampling finalized chunks');
  $('#activityStatus').className = `status-pill ${activity && sourceStatus?.ok !== false ? 'good' : 'warn'}`;
  const observations = state.observations;
  renderLineChart($('#blockTxChart'), observations, 'transactionCount', { label: 'Transactions per sampled finalized block', color: '#ddb3ef', format: 'count', dateKey: 'observedAt', emptyText: 'Waiting for at least two complete live samples. No historical transaction values are fabricated.' });
  const samples = observations.filter((row) => Number.isSafeInteger(row.transactionCount));
  $('#blockTxHistoryStatus').textContent = `${samples.length} complete local samples`;
  $('#blockTxHistorySpan').textContent = samples.length > 1 ? `${utcDateTime(samples[0].transactionFetchedAt)} to ${utcDateTime(samples.at(-1).transactionFetchedAt)}` : 'A local sample history appears after more five-minute polls.';
}
function riskPillClass(tone) { return tone === 'high' ? 'bad' : tone === 'positive' ? 'good' : 'warn'; }
function renderRisks() {
  const daily = allDailyRows(), tvl7d = windowChange(daily, 'tvlUsd', 7), tvl30d = windowChange(daily, 'tvlUsd', 30);
  const market = state.market ? { priceChange24h: state.market.priceChange24hPct } : null;
  const rpcStatus = state.rpcStatus?.chain_id === 'mainnet' ? state.rpcStatus : null;
  const block = state.block ? { ...state.block, ageSeconds: (Date.now() - state.block.timestampMs) / 1000 } : null;
  const risks = assessLiveRisks({ market, tvl7d, tvl30d, validators: state.validators, block, rpcStatus, blockActivity: state.blockActivity, declineThreshold: state.declineThreshold });
  $('#riskGrid').innerHTML = risks.map((risk) => {
    const sources = (RISK_SOURCE_IDS[risk.id] || []).map((sourceId) => DATA_SOURCES.find((source) => source.id === sourceId)).filter(Boolean);
    const sourceLinks = sources.length ? sources.map((source) => `<a href="${escapeHtml(source.docUrl || source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a>`).join(' · ') : 'No connected source';
    return `<article class="card risk-card"><div class="risk-top"><h3>${escapeHtml(risk.title)}</h3><span class="status-pill ${riskPillClass(risk.tone)}">${escapeHtml(risk.state)}</span></div><p><strong>Severity:</strong> ${escapeHtml(risk.severity)}</p><p><strong>Trend:</strong> ${escapeHtml(risk.trend)}</p><p><strong>Evidence:</strong> ${escapeHtml(risk.evidence)}</p><p class="risk-source"><strong>Sources:</strong> ${sourceLinks}</p><p><strong>Confidence:</strong> ${escapeHtml(risk.confidence)}</p><p class="risk-impact"><strong>Potential impact:</strong> ${escapeHtml(risk.impact)}</p><p class="risk-next"><strong>Next check:</strong> ${escapeHtml(risk.next)}</p></article>`;
  }).join('');
  $('#riskThresholdOutput').value = `${state.declineThreshold}%`;
  $('#riskThresholdOutput').textContent = `${state.declineThreshold}%`;
}
function renderCapital() {
  const daily = allDailyRows(), latest = daily.at(-1);
  const change7 = windowChange(daily, 'tvlUsd', 7), change30 = windowChange(daily, 'tvlUsd', 30);
  $('#latestTvl').textContent = latest ? shortUsd(latest.tvlUsd) : 'Unavailable';
  $('#tvlAsOf').textContent = latest ? `DefiLlama daily snapshot · ${latest.date} UTC` : 'No matched daily TVL point';
  $('#tvlChange7d').textContent = change7 ? formatSignedPercent(change7.changePct) : 'Unavailable';
  $('#tvlSpan7d').textContent = change7 ? `${change7.startDate} to ${change7.endDate} · USD TVL stock` : 'Needs at least 8 matched daily dates';
  $('#tvlChange30d').textContent = change30 ? formatSignedPercent(change30.changePct) : 'Unavailable';
  $('#tvlSpan30d').textContent = change30 ? `${change30.startDate} to ${change30.endDate} · USD TVL stock` : 'Needs at least 31 matched daily dates';
  renderLineChart($('#capitalChart'), daily, 'tvlUsd', { label: 'NEAR DeFi total value locked, daily USD snapshot', color: '#8bd3be', format: 'usd', emptyText: 'Waiting for aligned daily NEAR DeFi TVL and market dates.' });
  $('#tvlDateSpan').textContent = daily.length ? `${daily.length} complete matched dates · ${daily[0].date} to ${daily.at(-1).date}` : 'No aligned daily series';
  $('#capitalFreshness').textContent = state.tvlHistory?.fetchedAt ? `Fetched ${ago(state.tvlHistory.fetchedAt)}` : 'Source not yet fetched';
  $('#capitalStatus').textContent = latest ? 'TVL stock only · no net flows' : 'TVL unavailable';
  $('#capitalStatus').className = `status-pill ${latest ? 'warn' : 'bad'}`;
  $('#capitalLastChecked').textContent = state.tvlHistory?.fetchedAt ? `TVL response checked ${utcDateTime(state.tvlHistory.fetchedAt)}. No bridge or Intents flow feed is queried.` : 'No flow feed is queried.';
}
function renderHypothesis() {
  const daily = hypothesisRows(), metricA = $('#metricA')?.value || 'priceUsd', metricB = $('#metricB')?.value || 'tvlUsd';
  const direction = $('#hypothesisDirection')?.value || 'positive', days = Number($('#hypothesisDays')?.value || 14);
  const result = testHypothesis(daily, metricA, metricB, direction, days), title = $('#hypothesisLabel')?.value?.trim() || 'Untitled hypothesis';
  const verdict = $('#hypothesisVerdict');
  verdict.textContent = result.verdict;
  verdict.className = `result-verdict ${result.verdict === 'Not supported' ? 'negative' : ['Partially supported', 'Insufficient evidence'].includes(result.verdict) ? 'partial' : ''}`;
  const rText = result.r === null ? 'Correlation unavailable' : `Pearson r = ${result.r.toFixed(2)}`;
  $('#hypothesisSummary').textContent = `${title}. The selected test asks whether ${METRICS[metricA]?.label.toLowerCase()} and ${METRICS[metricB]?.label.toLowerCase()} show ${titleCaseDirection(direction)} across ${days} matched daily changes. ${rText}.`;
  const details = [`${result.n} matched daily changes${result.startDate && result.endDate ? ` · ${result.startDate} to ${result.endDate}` : ''}.`];
  if (result.r === null && result.n < days) details.push(`Correlation withheld: the selected test requires exactly ${days} consecutive matched daily changes; ${result.n} were available.`);
  else if (result.r === null) details.push('Correlation is undefined because at least one selected series has no variation in the complete window.');
  else if (result.verdict === 'Supported by available evidence') details.push('Observed co-movement matches the declared direction under the visible |r| ≥ 0.30 product rule.');
  else if (result.verdict === 'Not supported') details.push('Observed co-movement is strong in the direction opposite the selected hypothesis under the visible |r| ≥ 0.30 product rule.');
  else details.push('The selected series do not cross the product-rule threshold in either direction; this does not prove independence.');
  details.push('No p-value, causal attribution or forecast is calculated. Daily observations can be autocorrelated; address counts are not verified people or retention, and market/TVL values are not independent evidence of user adoption.');
  $('#hypothesisDetails').innerHTML = details.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}
function dataAvailableFor(sourceId) {
  return ({ 'near-rpc-finalized': Boolean(state.block), 'near-rpc-block-transactions': Boolean(state.blockActivity), 'near-rpc-status': Boolean(state.rpcStatus), 'near-rpc-validators': Boolean(state.validators), 'coingecko-market': Boolean(state.market), 'coingecko-history': Boolean(state.marketChart), 'defillama-price': Boolean(state.llamaPrice), 'defillama-tvl': Boolean(state.tvlHistory?.rows?.length) })[sourceId] ?? false;
}
function renderSources() {
  $('#sourceList').innerHTML = DATA_SOURCES.map((source) => {
    const status = state.sourceStatuses.get(source.id);
    let stateLabel = 'Not checked', pill = 'warn';
    if (!source.connected) { stateLabel = 'Not connected'; pill = 'warn'; }
    else if (status?.ok && sourceIsStale(status)) { stateLabel = 'Responding · observation stale'; pill = 'warn'; }
    else if (status?.ok) { stateLabel = 'Responding'; pill = 'good'; }
    else if (status && status.ok === false && dataAvailableFor(source.id)) { stateLabel = 'Request failed · last data retained'; pill = 'warn'; }
    else if (status && status.ok === false) { stateLabel = 'Unavailable'; pill = 'bad'; }
    const providerAt = status?.providerAt ?? status?.lastProviderAt;
    const providerAge = providerAt ? ` · observation ${ago(providerAt)}` : '';
    const freshnessLimit = source.staleAfterSeconds ? ` · stale after ${source.staleAfterSeconds < 60 ? `${source.staleAfterSeconds}s` : `${Math.round(source.staleAfterSeconds / 60)}m`}` : '';
    const retry = status?.retryAt && Date.parse(status.retryAt) > Date.now() ? ` · next retry after ${utcDateTime(status.retryAt)}` : '';
    const timestamp = status?.checkedAt ? `Checked ${utcDateTime(status.checkedAt)}${providerAt ? ` · provider time ${utcDateTime(providerAt)}` : ''}${providerAge}${freshnessLimit}${retry}${status.latencyMs !== null && status.latencyMs !== undefined ? ` · ${status.latencyMs} ms` : ''}` : source.connected ? 'Not fetched yet' : 'No request is made';
    const statusDetail = status?.detail ? ` Latest request: ${status.detail}.` : '';
    const endpointLink = `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${source.connected ? 'Live endpoint' : 'Candidate endpoint'}</a>`;
    const docsLink = source.docUrl ? ` · <a href="${escapeHtml(source.docUrl)}" target="_blank" rel="noopener noreferrer">Documentation</a>` : '';
    return `<article class="source-row"><div class="source-head"><b>${escapeHtml(source.name)}</b><span class="status-pill ${pill}">${escapeHtml(stateLabel)}</span></div><p><strong>Type:</strong> ${escapeHtml(source.kind)} · <strong>Fields:</strong> ${escapeHtml(source.fields)}</p><p><strong>Cadence:</strong> ${escapeHtml(source.cadence)}</p><p>${escapeHtml(source.caveat)}${escapeHtml(statusDetail)}</p><p class="timestamp">${escapeHtml(timestamp)}</p><p class="source-links">${endpointLink}${docsLink}</p></article>`;
  }).join('');
}
function renderAll() { renderOverview(); renderValueCapture(); renderParticipation(); renderRisks(); renderCapital(); renderHypothesis(); renderSources(); updateHeader(); }
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
      const activityResult = await fetchAndApply('blockActivity', () => fetchBlockTransactionCount(block));
      const activity = activityResult?.value;
      if (activity && activity.blockHeight === block.height) appendBlockObservation({ ...block, transactionCount: activity.transactionCount, transactionChunkCount: activity.chunkCount, transactionFetchedAt: activity.fetchedAt });
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
  } finally { state.isRefreshing = false; button.disabled = false; button.innerHTML = '↻ <span>Refresh</span>'; renderAll(); }
}
function exportEvidence() {
  const bundle = {
    project: 'NEAR SIGNAL', exportedAt: new Date().toISOString(), status: 'local prototype; not published or deployed',
    live: { market: state.market, independentSpotPrice: state.llamaPrice, finalizedBlock: state.block, sampledFinalizedBlockTransactions: state.blockActivity,
      rpcStatus: state.rpcStatus ? { chainId: state.rpcStatus.chain_id, syncing: state.rpcStatus.syncing, latestBlockHeight: state.rpcStatus.sync_info?.latest_block_height, latestBlockTime: state.rpcStatus.sync_info?.latest_block_time } : null,
      currentValidatorSet: state.validators },
    dailyAlignedMarketAndTvl: allDailyRows(), dailyHypothesisSeries: hypothesisRows(), rawTvlRows: state.tvlHistory?.rows ?? null, rawCoinGeckoMarketChart: state.marketChart,
    localRpcObservationHistory: state.observations,
    sourceRegistry: DATA_SOURCES.map((source) => ({ ...source, status: state.sourceStatuses.get(source.id) ?? null })),
    limitations: ['The sampled transaction count is for one finalized block and is not a daily series, unique-user count, retention measure or adoption trend.', 'Daily account cohorts and retention remain unavailable; no provider API key is required or configured.', 'No canonical, deduplicated Intents or bridge net-flow history is connected.', 'Market volume is gross exchange activity; TVL is a USD stock; neither is net investment.', 'The NEAR Ecosystem Health Score is withheld because key evidence dimensions are missing.', 'The hypothesis calculation is descriptive correlation only; it does not establish causation or statistical significance.', 'Local RPC observation history only accrues while this browser is open and is not a chain archive.'],
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `near-signal-evidence-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
}
function setupInteractions() {
  $('#windowSelect').addEventListener('change', (event) => { state.days = Number(event.target.value) || 14; renderAll(); });
  $('#riskThreshold').addEventListener('input', (event) => { state.declineThreshold = Number(event.target.value) || 20; $('#riskThresholdOutput').value = `${state.declineThreshold}%`; $('#riskThresholdOutput').textContent = `${state.declineThreshold}%`; $('#riskThresholdStatus').textContent = `Risk states recalculated with a ${state.declineThreshold} percent decline threshold.`; renderRisks(); });
  document.querySelectorAll('[data-chart-metric]').forEach((button) => button.addEventListener('click', () => {
    state.chartMetric = button.dataset.chartMetric;
    document.querySelectorAll('[data-chart-metric]').forEach((node) => node.setAttribute('aria-pressed', String(node === button)));
    renderOverview();
  }));
  ['metricA', 'metricB', 'hypothesisDirection', 'hypothesisDays', 'hypothesisLabel'].forEach((id) => $(`#${id}`).addEventListener('input', renderHypothesis));
  ['metricA', 'metricB', 'hypothesisDirection', 'hypothesisDays'].forEach((id) => $(`#${id}`).addEventListener('change', renderHypothesis));
  $('#runHypothesisButton').addEventListener('click', renderHypothesis);
  $('#refreshButton').addEventListener('click', refreshEverything);
  $('#exportButton').addEventListener('click', exportEvidence);
  $('#exportMethodButton').addEventListener('click', exportEvidence);
  const links = [...document.querySelectorAll('.nav a')];
  const observer = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) links.forEach((link) => link.classList.toggle('active', link.hash === `#${entry.target.id}`)); }, { rootMargin: '-24% 0px -66% 0px' });
  document.querySelectorAll('main section[id]').forEach((section) => observer.observe(section));
}

setupInteractions();
renderAll();
void initialLoad();
setInterval(() => { void refreshBlock(); }, FAST_INTERVAL_MS);
setInterval(() => { void refreshDefiPrice(); }, DEFI_PRICE_INTERVAL_MS);
setInterval(() => { void refreshSlowRpc(); }, SLOW_RPC_INTERVAL_MS);
setInterval(() => { void refreshTvl(); }, TVL_INTERVAL_MS);
setInterval(() => { renderBlockAge(); renderRisks(); }, 1000);
