import { assessRisk, compareWindows, nearHealthCoverage, pearsonCorrelation, signerConcentration, testAdoptionHypothesis, formatSignedPercent } from './analytics.js';
import { DATA_SOURCES, loadNearSignalData } from './data.js';

const $ = (id) => document.getElementById(id);
const state = {
  data: null,
  days: 14,
  overviewMetric: 'txns',
  valueMetric: 'feesNear',
  adoptionMetric: 'activeAccounts',
  threshold: 20,
  hypothesis: null,
  refreshing: false,
};

const series = {
  txns: { label: 'Transactions', unit: 'transactions', color: '#c8f27c', precision: 0 },
  activeAccounts: { label: 'Active accounts', unit: 'accounts', color: '#8bd3be', precision: 0 },
  feesNear: { label: 'Indexed fees', unit: 'Ⓝ', color: '#edc47d', precision: 2 },
  activeContracts: { label: 'Active contracts', unit: 'contracts', color: '#8ab9db', precision: 0 },
  indexedVolumeNear: { label: 'Indexed transaction volume', unit: 'Ⓝ', color: '#8ab9db', precision: 2 },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function number(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(Number(value));
}

function compact(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: digits }).format(Number(value));
}

function near(value, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${number(value, digits)} Ⓝ`;
}

function shortDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function fullDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function localTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function changeLabel(value, suffix = 'vs prior window') {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No complete matched comparison';
  return `${formatSignedPercent(value)} ${suffix}`;
}

function paintChange(id, value) {
  const element = $(id);
  if (!element) return;
  element.textContent = changeLabel(value);
  element.className = `kpi-foot change ${value === null || !Number.isFinite(value) ? 'neutral' : value >= 0 ? 'up' : 'down'}`;
}

function setMetric(id, value) {
  const element = $(id);
  if (!element) return;
  element.textContent = value;
  element.classList.remove('loading');
}

function lineChart(rows, key, containerId, ariaLabel) {
  const container = $(containerId);
  const definition = series[key];
  const values = rows.map((row) => ({ date: row.date, value: row[key] })).filter((row) => row.value !== null && row.value !== undefined && Number.isFinite(Number(row.value)));
  if (values.length < 2) {
    container.innerHTML = '<div class="chart-empty">A dated series is not available from both required feeds. No sample data is shown.</div>';
    return;
  }
  const width = 820;
  const height = 238;
  const left = 70;
  const right = 18;
  const top = 16;
  const bottom = 34;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const min = Math.min(0, ...values.map((item) => Number(item.value)));
  const max = Math.max(...values.map((item) => Number(item.value)), 1);
  const upper = max === min ? max + 1 : max * 1.08;
  const x = (index) => left + (index / (values.length - 1)) * innerWidth;
  const y = (value) => top + innerHeight - ((Number(value) - min) / (upper - min)) * innerHeight;
  const path = values.map((item, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(item.value).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((fraction) => {
    const tickValue = min + (upper - min) * fraction;
    const py = y(tickValue);
    return `<line x1="${left}" y1="${py}" x2="${width - right}" y2="${py}" stroke="#2c3831" stroke-dasharray="3 5"/><text x="${left - 10}" y="${py + 3}" text-anchor="end" fill="#829087" font-size="10">${escapeHtml(compact(tickValue, 0))}</text>`;
  }).join('');
  const dateIndices = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];
  const dates = dateIndices.map((index) => {
    const anchor = index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle';
    return `<text x="${x(index)}" y="${height - 7}" text-anchor="${anchor}" fill="#829087" font-size="10">${escapeHtml(shortDate(values[index].date))}</text>`;
  }).join('');
  const dots = values.map((item, index) => `<circle cx="${x(index)}" cy="${y(item.value)}" r="2.2" fill="${definition.color}"><title>${escapeHtml(item.date)} · ${escapeHtml(number(item.value, definition.precision))} ${escapeHtml(definition.unit)}</title></circle>`).join('');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}"><title>${escapeHtml(ariaLabel)}</title>${ticks}<path d="${path}" fill="none" stroke="${definition.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}${dates}</svg>`;
}

function renderSources(data) {
  $('sourceList').innerHTML = DATA_SOURCES.map((source) => {
    const status = data?.sourceStatuses?.find((item) => item.sourceId === source.id);
    const badge = !status ? '<span class="status-pill">Not checked</span>' : status.ok ? '<span class="status-pill good">Request succeeded</span>' : '<span class="status-pill bad">Unavailable</span>';
    const message = status && !status.ok ? ` Last error: ${status.detail}.` : '';
    return `<div class="source-row"><div class="source-head"><b>${escapeHtml(source.name)}</b>${badge}</div><p>${escapeHtml(source.kind)} · ${escapeHtml(source.fields)}. ${escapeHtml(source.caveat)}${escapeHtml(message)}</p><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Open endpoint ↗</a> · <a href="${escapeHtml(source.docUrl)}" target="_blank" rel="noopener noreferrer">Official docs ↗</a></div>`;
  }).join('');
  $('refreshTimestamp').textContent = data ? `Fetched ${localTime(data.loadedAt)}` : 'Not yet loaded';
}

function renderChartCaptions(data) {
  const rows = data?.daily ?? [];
  const start = rows[0]?.date;
  const end = rows.at(-1)?.date;
  $('observedSpan').textContent = start && end ? `${fullDate(start)} – ${fullDate(end)} · ${rows.length} matched days` : 'No matched daily observations';
  $('dataAsOf').textContent = end ? `Latest matched date: ${fullDate(end)} UTC` : 'Latest complete date: —';
  const comparison = data ? compareWindows(data.daily, state.days) : null;
  const current = comparison?.current ?? [];
  const first = current[0]?.date;
  const last = current.at(-1)?.date;
  const span = first && last ? `${shortDate(first)} – ${shortDate(last)} UTC` : 'No current window';
  $('valueDateSpan').textContent = span;
  $('adoptionDateSpan').textContent = span;
  $('windowDescription').textContent = comparison?.ready
    ? `Mean per day, ${fullDate(comparison.startDate)}–${fullDate(comparison.endDate)} UTC, vs ${fullDate(comparison.priorStartDate)}–${fullDate(comparison.priorEndDate)} UTC.`
    : `Need two contiguous ${state.days}-day windows to calculate a change. Partial data is not treated as a matched comparison.`;
}

function renderOverview(data) {
  const comparison = compareWindows(data.daily, state.days);
  const currentReady = comparison.currentReady;
  const current = comparison.currentMeans;
  setMetric('overviewTxns', currentReady ? compact(current.txns, 1) : 'Insufficient days');
  setMetric('overviewAccounts', currentReady ? compact(current.activeAccounts, 1) : 'Insufficient days');
  setMetric('overviewFees', currentReady ? near(current.feesNear, 2) : 'Insufficient days');
  setMetric('overviewContracts', currentReady ? compact(current.activeContracts, 1) : current.activeContracts === null ? 'Unavailable' : 'Insufficient days');
  paintChange('overviewTxnsChange', comparison.ready ? comparison.changes.txns : null);
  paintChange('overviewAccountsChange', comparison.ready ? comparison.changes.activeAccounts : null);
  paintChange('overviewFeesChange', comparison.ready ? comparison.changes.feesNear : null);
  paintChange('overviewContractsChange', comparison.ready ? comparison.changes.activeContracts : null);

  lineChart(data.daily.slice(-Math.max(28, state.days * 2)), state.overviewMetric, 'overviewChart', `${series[state.overviewMetric].label} daily series`);
  $('overviewChartSubtitle').textContent = `${series[state.overviewMetric].label} · source-reported daily values on matched UTC dates`;

  const sampleStats = signerConcentration(data.recentTransactions);
  const coverage = nearHealthCoverage(comparison, sampleStats, data.rpcStatus);
  $('coverageText').textContent = `${coverage.measured} / ${coverage.total} domains with some signal`;
  $('coverageFill').style.width = `${Math.round((coverage.measured / coverage.total) * 100)}%`;
  $('scoreState').textContent = 'Withheld — insufficient evidence';
  $('scoreCopy').textContent = 'Two dimensions have daily historical observations, one has only a point-in-time RPC response, and capital/concentration are not measured ecosystem-wide. No overall NEHS number is issued.';
  const labels = ['Economic sustainability', 'Organic adoption', 'Capital resilience', 'Concentration & dependency', 'Infrastructure health'];
  const statuses = [
    comparison.ready && current.feesNear !== null ? 'Observed · not scored' : 'Incomplete history',
    comparison.ready && current.activeAccounts !== null ? 'Observed · not scored' : 'Incomplete history',
    'Missing · no net-flow series',
    sampleStats.sampleSize ? 'Sample only · not network-wide' : 'Missing · no contract distribution',
    data.rpcStatus ? 'One RPC snapshot only' : 'RPC snapshot unavailable',
  ];
  $('dimensionList').innerHTML = labels.map((label, index) => `<div class="dimension-row"><span>${escapeHtml(label)}</span><span class="dim-status">${escapeHtml(statuses[index])}</span></div>`).join('');
  $('observedSummary').textContent = comparison.ready
    ? `${compact(current.txns, 0)} transactions/day, ${compact(current.activeAccounts, 0)} active accounts/day, and ${near(current.feesNear, 2)} indexed fees/day on average in the selected window.`
    : 'The available daily observations are not sufficient for two complete, contiguous comparison windows.';
  $('overallAssessment').textContent = comparison.ready
    ? `Usage and fee indicators are observable for ${state.days}-day windows, but a point-in-time indexer view cannot establish organic retention, capital resilience or long-run ecosystem health. NEHS remains withheld.`
    : 'Insufficient matched history. NEHS remains withheld; no historical conclusion is made.';
}

function renderValueCapture(data) {
  const comparison = compareWindows(data.daily, state.days);
  const currentReady = comparison.currentReady;
  const means = comparison.currentMeans;
  setMetric('valueTxns', currentReady ? compact(means.txns, 1) : 'Insufficient days');
  setMetric('valueFees', currentReady ? near(means.feesNear, 2) : 'Insufficient days');
  const feePerTxn = means.txns && means.feesNear !== null ? means.feesNear / means.txns : null;
  setMetric('valueFeePerTxn', feePerTxn === null ? 'Unavailable' : `${number(feePerTxn, 6)} Ⓝ`);
  setMetric('valueVolume', currentReady ? near(means.indexedVolumeNear, 0) : 'Insufficient days');
  $('valueTxnsFoot').textContent = comparison.ready ? changeLabel(comparison.changes.txns) : `Matched ${state.days}-day window`;
  $('valueFeesFoot').textContent = comparison.ready ? `${changeLabel(comparison.changes.feesNear)} · not revenue` : 'Ⓝ · not protocol revenue';
  const allValues = [means.txns, means.feesNear, means.indexedVolumeNear];
  const available = currentReady && allValues.some((value) => value !== null);
  $('valueStatus').textContent = available ? 'Indexed observations available' : 'Insufficient source data';
  $('valueStatus').className = `status-pill ${available ? 'good' : 'warn'}`;
  lineChart(data.daily.slice(-Math.max(28, state.days * 2)), state.valueMetric, 'valueChart', `${series[state.valueMetric].label} daily series`);
}

function renderAdoption(data) {
  const comparison = compareWindows(data.daily, state.days);
  const currentReady = comparison.currentReady;
  const means = comparison.currentMeans;
  lineChart(data.daily.slice(-Math.max(28, state.days * 2)), state.adoptionMetric, 'adoptionChart', `${series[state.adoptionMetric].label} daily series`);
  setMetric('adoptionAccounts', currentReady ? compact(means.activeAccounts, 1) : 'Insufficient days');
  setMetric('adoptionContracts', currentReady ? compact(means.activeContracts, 1) : 'Unavailable');
  setMetric('adoptionFrequency', currentReady && comparison.txnsPerActiveAccountCurrent !== null ? number(comparison.txnsPerActiveAccountCurrent, 2) : 'Unavailable');
  $('adoptionAccountsChange').textContent = comparison.ready ? changeLabel(comparison.changes.activeAccounts) : 'No complete matched comparison';
  $('adoptionContractsChange').textContent = comparison.ready ? changeLabel(comparison.changes.activeContracts) : 'No complete matched comparison';
  $('adoptionFrequencyChange').textContent = comparison.ready ? changeLabel(comparison.txnsPerActiveAccountChange) : 'No complete matched comparison';
  $('adoptionStatus').textContent = comparison.ready ? 'Daily breadth indicators available' : 'Insufficient matched days';
  $('adoptionStatus').className = `status-pill ${comparison.ready ? 'good' : 'warn'}`;
}

function renderRisk(data) {
  const comparison = compareWindows(data.daily, state.days);
  const sampleStats = signerConcentration(data.recentTransactions);
  const risks = assessRisk(comparison, sampleStats, data.rpcStatus, state.threshold);
  $('riskGrid').innerHTML = risks.map((risk) => {
    const tone = risk.tone === 'high' ? 'bad' : risk.tone === 'positive' ? 'good' : 'warn';
    return `<article class="card risk-card"><div class="risk-top"><h3>${escapeHtml(risk.title)}</h3><span class="status-pill ${tone}">${escapeHtml(risk.state)}</span></div><p class="risk-severity"><strong>Severity:</strong> ${escapeHtml(risk.severity)}</p><p class="risk-trend"><strong>Historical trend:</strong> ${escapeHtml(risk.trend)}</p><p>${escapeHtml(risk.evidence)}</p><p class="risk-confidence"><strong>Confidence:</strong> ${escapeHtml(risk.confidence)}</p><p class="risk-impact">${escapeHtml(risk.impact)}</p><p class="risk-next"><strong>Investigate:</strong> ${escapeHtml(risk.next)}</p></article>`;
  }).join('');
  $('riskThresholdOutput').textContent = `${state.threshold}%`;
}

function renderHypothesis(data) {
  if (!state.hypothesis) return;
  const verdict = $('hypothesisVerdict');
  verdict.textContent = state.hypothesis.verdict;
  verdict.className = `result-verdict ${state.hypothesis.verdict.startsWith('Not supported') ? 'negative' : state.hypothesis.verdict.startsWith('Partially') || state.hypothesis.verdict.startsWith('Insufficient') ? 'partial' : ''}`;
  $('hypothesisSummary').textContent = state.hypothesis.summary;
  $('hypothesisDetails').innerHTML = state.hypothesis.details.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}

function render(data) {
  renderSources(data);
  renderChartCaptions(data);
  renderOverview(data);
  renderValueCapture(data);
  renderAdoption(data);
  renderRisk(data);
  renderHypothesis(data);
  const essentialsOk = data.sourceStatuses.filter((item) => ['nearblocks-txn-stats', 'nearblocks-address-stats'].includes(item.sourceId)).every((item) => item.ok);
  const dot = $('feedDot');
  dot.className = `feed-dot ${essentialsOk && data.daily.length ? 'ok' : data.daily.length ? '' : 'bad'}`;
  $('feedStatus').textContent = essentialsOk && data.daily.length ? 'Public indexer data loaded' : 'One or more required data feeds unavailable';
  $('refreshTimestamp').textContent = `Fetched ${localTime(data.loadedAt)}`;
  const latest = data.daily.at(-1)?.date;
  $('footerFreshness').textContent = latest ? `Latest matched date ${fullDate(latest)} UTC · fetched ${localTime(data.loadedAt)}.` : 'No matched daily data. No fabricated values are shown.';
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  $('refreshButton').disabled = true;
  $('refreshButton').setAttribute('aria-busy', 'true');
  $('feedStatus').textContent = 'Refreshing public read-only sources';
  try {
    state.data = await loadNearSignalData();
    render(state.data);
  } catch (error) {
    $('feedDot').className = 'feed-dot bad';
    $('feedStatus').textContent = 'Refresh failed';
    $('overviewChart').innerHTML = `<div class="chart-empty">Could not load public observations. No synthetic fallback is used. ${escapeHtml(error?.message || 'Unexpected data-layer error')}</div>`;
    $('valueChart').innerHTML = '<div class="chart-empty">No real feed was loaded.</div>';
    $('adoptionChart').innerHTML = '<div class="chart-empty">No real feed was loaded.</div>';
  } finally {
    state.refreshing = false;
    $('refreshButton').disabled = false;
    $('refreshButton').removeAttribute('aria-busy');
  }
}

function runHypothesis(event) {
  event?.preventDefault();
  if (!state.data) return;
  const comparison = compareWindows(state.data.daily, state.days);
  const correlationRows = [...comparison.prior, ...comparison.current];
  const correlation = pearsonCorrelation(correlationRows, 'txns', 'activeAccounts');
  state.hypothesis = testAdoptionHypothesis(comparison, correlation);
  renderHypothesis(state.data);
}

function exportEvidence() {
  if (!state.data) return;
  const comparison = compareWindows(state.data.daily, state.days);
  const correlation = pearsonCorrelation([...comparison.prior, ...comparison.current], 'txns', 'activeAccounts');
  const payload = {
    product: 'NEAR SIGNAL',
    exportedAt: new Date().toISOString(),
    interpretation: 'Read-only evidence bundle. Not investment advice. Daily activity is not verified-human adoption; fees are not protocol revenue; indexed volume is not net capital flow.',
    windowDays: state.days,
    matchedWindow: {
      ready: comparison.ready,
      currentStart: comparison.startDate,
      currentEnd: comparison.endDate,
      priorStart: comparison.priorStartDate,
      priorEnd: comparison.priorEndDate,
      currentMeans: comparison.currentMeans,
      priorMeans: comparison.priorMeans,
      changesPercent: comparison.changes,
      txnsPerActiveAccountCurrent: comparison.txnsPerActiveAccountCurrent,
      txnsPerActiveAccountPrior: comparison.txnsPerActiveAccountPrior,
      txnsPerActiveAccountChangePercent: comparison.txnsPerActiveAccountChange,
      dailyTransactionsActiveAccountsCorrelation: correlation,
    },
    riskThresholdPercent: state.threshold,
    recentSignerSample: signerConcentration(state.data.recentTransactions),
    rpcObservation: state.data.rpcStatus ? {
      chainId: state.data.rpcStatus.chain_id,
      latestBlockHeight: state.data.rpcStatus.sync_info?.latest_block_height,
      latestBlockTime: state.data.rpcStatus.sync_info?.latest_block_time,
      syncing: state.data.rpcStatus.sync_info?.syncing,
    } : null,
    dailyObservations: state.data.daily,
    sourceStatuses: state.data.sourceStatuses,
    sourceRegistry: DATA_SOURCES,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `near-signal-evidence-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setSelectedMetric(attribute, value) {
  state[attribute] = value;
  document.querySelectorAll(`[data-${attribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`).forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset[attribute.replace(/[A-Z]/g, (letter) => letter.toLowerCase())] === value));
  });
  if (state.data) render(state.data);
}

function bindControls() {
  $('refreshButton').addEventListener('click', refresh);
  $('exportButton').addEventListener('click', exportEvidence);
  $('exportMethodButton').addEventListener('click', exportEvidence);
  $('windowSelect').addEventListener('change', (event) => {
    state.days = Number(event.target.value);
    state.hypothesis = null;
    if (state.data) render(state.data);
  });
  document.querySelectorAll('[data-overview-metric]').forEach((button) => button.addEventListener('click', () => {
    state.overviewMetric = button.dataset.overviewMetric;
    document.querySelectorAll('[data-overview-metric]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    if (state.data) render(state.data);
  }));
  document.querySelectorAll('[data-value-metric]').forEach((button) => button.addEventListener('click', () => {
    state.valueMetric = button.dataset.valueMetric;
    document.querySelectorAll('[data-value-metric]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    if (state.data) render(state.data);
  }));
  document.querySelectorAll('[data-adoption-metric]').forEach((button) => button.addEventListener('click', () => {
    state.adoptionMetric = button.dataset.adoptionMetric;
    document.querySelectorAll('[data-adoption-metric]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    if (state.data) render(state.data);
  }));
  $('riskThreshold').addEventListener('input', (event) => {
    state.threshold = Number(event.target.value);
    $('riskThresholdOutput').textContent = `${state.threshold}%`;
    if (state.data) renderRisk(state.data);
  });
  $('runHypothesisButton').addEventListener('click', runHypothesis);
  const sections = [...document.querySelectorAll('main .block[id]')];
  const navLinks = [...document.querySelectorAll('.nav a')];
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) navLinks.forEach((link) => link.classList.toggle('active', link.hash === `#${visible.target.id}`));
    }, { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.15, 0.35] });
    sections.forEach((section) => observer.observe(section));
  }
}

bindControls();
renderSources(null);
refresh();
