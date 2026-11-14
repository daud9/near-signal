export const DEFAULT_WINDOW_DAYS = 14;
export const DEFAULT_ALERT_DECLINE_PCT = 20;

const numeric = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function normalizeDailyRows(txRows = [], accountRows = [], todayUtc = new Date().toISOString().slice(0, 10)) {
  const byDate = (rows) => new Map(rows
    .filter((row) => row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')))
    .map((row) => [row.date, row]));
  const txByDate = byDate(txRows);
  const accountsByDate = byDate(accountRows);
  const dates = [...txByDate.keys()]
    .filter((date) => date < todayUtc && accountsByDate.has(date))
    .sort();

  return dates.map((date) => {
    const tx = txByDate.get(date);
    const accounts = accountsByDate.get(date);
    return {
      date,
      txns: numeric(tx.txns),
      feesNear: numeric(tx.txn_fee),
      indexedVolumeNear: numeric(tx.txn_volume),
      receipts: numeric(tx.receipts),
      activeAccounts: numeric(accounts.active_accounts),
      activeContracts: numeric(accounts.active_contracts),
      newContracts: numeric(accounts.new_contracts),
      metaAccounts: numeric(accounts.meta_accounts),
    };
  }).filter((row) => row.txns !== null && row.activeAccounts !== null);
}

function average(rows, key) {
  const values = rows.map((row) => numeric(row[key])).filter((value) => value !== null);
  return rows.length && values.length === rows.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentChange(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function hasDailyContinuity(rows) {
  if (rows.length < 2) return true;
  for (let index = 1; index < rows.length; index += 1) {
    const before = Date.parse(`${rows[index - 1].date}T00:00:00Z`);
    const after = Date.parse(`${rows[index].date}T00:00:00Z`);
    if (after - before !== 86_400_000) return false;
  }
  return true;
}

export function compareWindows(rows, days = DEFAULT_WINDOW_DAYS) {
  const current = rows.slice(-days);
  const prior = rows.slice(-2 * days, -days);
  const currentReady = current.length === days && hasDailyContinuity(current);
  const priorReady = prior.length === days && hasDailyContinuity(prior);
  const ready = currentReady && priorReady && hasDailyContinuity([...prior, ...current]);
  const metrics = ['txns', 'activeAccounts', 'activeContracts', 'feesNear', 'indexedVolumeNear', 'receipts'];
  const currentMeans = Object.fromEntries(metrics.map((key) => [key, average(current, key)]));
  const priorMeans = Object.fromEntries(metrics.map((key) => [key, average(prior, key)]));
  const changes = Object.fromEntries(metrics.map((key) => [key, ready ? percentChange(currentMeans[key], priorMeans[key]) : null]));
  const ratioCurrent = currentReady && currentMeans.activeAccounts ? currentMeans.txns / currentMeans.activeAccounts : null;
  const ratioPrior = priorReady && priorMeans.activeAccounts ? priorMeans.txns / priorMeans.activeAccounts : null;

  return {
    current,
    prior,
    days,
    ready,
    currentReady,
    priorReady,
    currentMeans,
    priorMeans,
    changes,
    txnsPerActiveAccountCurrent: ratioCurrent,
    txnsPerActiveAccountPrior: ratioPrior,
    txnsPerActiveAccountChange: ready ? percentChange(ratioCurrent, ratioPrior) : null,
    startDate: current[0]?.date ?? null,
    endDate: current.at(-1)?.date ?? null,
    priorStartDate: prior[0]?.date ?? null,
    priorEndDate: prior.at(-1)?.date ?? null,
  };
}

export function signerConcentration(transactions = []) {
  const signers = transactions.map((row) => row?.signer_account_id).filter((signer) => typeof signer === 'string' && signer.length > 0);
  if (!signers.length) return { sampleSize: 0, uniqueSigners: 0, topSigner: null, topShare: null, hhi: null };
  const counts = new Map();
  for (const signer of signers) counts.set(signer, (counts.get(signer) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const hhi = sorted.reduce((sum, [, count]) => sum + ((count / signers.length) ** 2) * 10_000, 0);
  return {
    sampleSize: signers.length,
    uniqueSigners: counts.size,
    topSigner: sorted[0][0],
    topShare: sorted[0][1] / signers.length,
    hhi,
  };
}

export function pearsonCorrelation(rows, keyA, keyB) {
  const pairs = rows.map((row) => [numeric(row[keyA]), numeric(row[keyB])]).filter(([a, b]) => a !== null && b !== null);
  if (pairs.length < 3) return { n: pairs.length, r: null };
  const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length;
  const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (const [a, b] of pairs) {
    const da = a - meanA;
    const db = b - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (!varianceA || !varianceB) return { n: pairs.length, r: null };
  return { n: pairs.length, r: covariance / Math.sqrt(varianceA * varianceB) };
}

export function assessRisk(comparison, sampleStats, rpcStatus, declineThreshold = DEFAULT_ALERT_DECLINE_PCT) {
  const threshold = Math.max(5, Math.min(50, Number(declineThreshold) || DEFAULT_ALERT_DECLINE_PCT));
  const adoptionChange = comparison?.changes?.activeAccounts;
  const feeChange = comparison?.changes?.feesNear;
  const currentBlockTime = rpcStatus?.sync_info?.latest_block_time;

  return [
    {
      id: 'concentration', title: 'Ecosystem concentration',
      state: sampleStats?.sampleSize ? 'Limited sample' : 'Data gap', tone: 'caution',
      severity: sampleStats?.sampleSize ? 'Unrated — limited sample' : 'Unrated — no sample',
      trend: 'Not available — only a recent signer sample is fetched; no concentration time series is connected.',
      confidence: sampleStats?.sampleSize ? `Low — ${sampleStats.sampleSize}-row recent signer sample only` : 'Insufficient evidence',
      evidence: sampleStats?.sampleSize
        ? `${sampleStats.sampleSize} newest indexed transactions only: top signer ${formatPercent(sampleStats.topShare)}; sample HHI ${Math.round(sampleStats.hhi)}. Not a network-wide estimate.`
        : 'No transaction sample was returned. Ecosystem-wide application and contract concentration are not measured.',
      impact: 'A small number of applications or participants could make activity less resilient, but this sample cannot establish that risk.',
      next: 'Use full historical signer and contract-level data before classifying ecosystem concentration.',
    },
    {
      id: 'adoption', title: 'Adoption sustainability',
      state: adoptionChange === null ? 'Insufficient history' : adoptionChange <= -threshold ? 'Decline alert' : 'Observed',
      tone: adoptionChange !== null && adoptionChange <= -threshold ? 'high' : 'neutral',
      severity: adoptionChange === null ? 'Unrated — incomplete history' : adoptionChange <= -threshold ? `Elevated signal — exceeds ${threshold}% decline threshold` : 'No configured decline signal',
      trend: adoptionChange === null ? 'Unavailable — matched daily history is incomplete.' : `Active account identifiers ${formatSignedPercent(adoptionChange)} across matched ${comparison.days}-day windows.`,
      confidence: adoptionChange === null ? 'Insufficient evidence' : 'Moderate for indexed counts; low for human adoption or retention',
      evidence: adoptionChange === null
        ? 'Matched daily active-account history is unavailable or incomplete.'
        : `Daily active accounts changed ${formatSignedPercent(adoptionChange)} across matched ${comparison.days}-day windows. Accounts are not verified people or retained users.`,
      impact: 'A sustained drop in distinct active accounts may indicate weaker participation; daily counts alone do not prove retention or human adoption.',
      next: 'Compare returning accounts and application-level retention once identity-safe historical data is available.',
    },
    {
      id: 'capital', title: 'Capital and liquidity', state: 'Data gap', tone: 'caution',
      severity: 'Unrated — data gap',
      trend: 'Unavailable — no verified net-flow time series is connected.',
      confidence: 'Insufficient evidence — no verified net-flow series',
      evidence: 'No defensible net inflow/outflow series is connected. Indexed transaction volume is not net capital flow or investment.',
      impact: 'Liquidity exits, concentration, and cross-chain dependencies remain unassessed.',
      next: 'Add a verified Intents/bridge event source with asset prices, transfer direction, and duplicate handling.',
    },
    {
      id: 'infrastructure', title: 'Infrastructure health',
      state: rpcStatus ? 'RPC responded' : 'RPC unavailable',
      tone: rpcStatus ? 'positive' : 'caution',
      severity: rpcStatus ? 'Unrated — point-in-time check only' : 'Unrated — endpoint unavailable',
      trend: 'Not available — a single status response cannot show historical uptime or performance.',
      confidence: rpcStatus ? 'Low — one endpoint check; not an uptime history' : 'Insufficient evidence',
      evidence: rpcStatus
        ? `Read-only mainnet status response${rpcStatus.sync_info?.latest_block_height ? ` at block ${Number(rpcStatus.sync_info.latest_block_height).toLocaleString()}` : ''}${currentBlockTime ? `; latest block timestamp ${new Date(currentBlockTime).toISOString()}` : ''}. A single check is not an uptime history or security assessment.`
        : 'The public NEAR RPC status request did not return a usable mainnet response.',
      impact: 'This check can reveal that the endpoint responded at one moment; it cannot quantify historical availability, validator concentration, or finality reliability.',
      next: 'Store repeated, timestamped status and block observations before making reliability comparisons.',
    },
    {
      id: 'economics', title: 'Economic sustainability',
      state: feeChange === null ? 'Insufficient history' : feeChange <= -threshold ? 'Fee decline alert' : 'Observed',
      tone: feeChange !== null && feeChange <= -threshold ? 'high' : 'neutral',
      severity: feeChange === null ? 'Unrated — incomplete history' : feeChange <= -threshold ? `Elevated signal — exceeds ${threshold}% decline threshold` : 'No configured decline signal',
      trend: feeChange === null ? 'Unavailable — matched daily fee history is incomplete.' : `Indexed fees ${formatSignedPercent(feeChange)} across matched ${comparison.days}-day windows.`,
      confidence: feeChange === null ? 'Insufficient evidence' : 'Moderate for indexed fee direction; low for value-capture interpretation',
      evidence: feeChange === null
        ? 'Matched daily fee observations are unavailable or incomplete.'
        : `Indexed transaction fees (Ⓝ) changed ${formatSignedPercent(feeChange)} across matched windows. Fee totals are not protocol revenue, token value, or proof of sustainable demand.`,
      impact: 'Falling fees alongside activity changes merit investigation, but fees can move for reasons that do not map directly to network health.',
      next: 'Inspect fee trends with usage, token-economic changes, and application mix; do not infer token returns.',
    },
    {
      id: 'dependencies', title: 'Ecosystem dependencies', state: 'Not assessed', tone: 'caution',
      severity: 'Unrated — not assessed',
      trend: 'Not available — no verified dependency inventory or incident history is connected.',
      confidence: 'Insufficient evidence — no dependency inventory',
      evidence: 'No verified protocol, liquidity-provider, bridge, or critical-service dependency inventory is connected.',
      impact: 'Concentration in critical external services or a few protocols could create systemic exposure that this MVP cannot yet map.',
      next: 'Build a sourced ecosystem dependency register and link each dependency to observable incident or liquidity data.',
    },
  ];
}

export function formatPercent(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(digits)}%`;
}

export function formatSignedPercent(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function nearHealthCoverage(comparison, sampleStats, rpcStatus) {
  const dims = [
    Boolean(comparison?.currentReady && comparison.currentMeans.feesNear !== null),
    Boolean(comparison?.currentReady && comparison.currentMeans.activeAccounts !== null),
    false,
    false,
    Boolean(rpcStatus),
  ];
  return { measured: dims.filter(Boolean).length, total: dims.length, components: dims };
}

export function testAdoptionHypothesis(comparison, correlation) {
  if (!comparison?.ready || correlation?.r === null || correlation?.r === undefined) {
    return { verdict: 'Insufficient evidence', summary: 'The matched daily series is too short, incomplete, or missing a required measure.', details: [] };
  }
  const txChange = comparison.changes.txns;
  const accountChange = comparison.changes.activeAccounts;
  const corr = correlation.r;
  let verdict = 'Partially supported';
  if (txChange > 0 && accountChange > 0 && corr >= 0.3) verdict = 'Supported by available evidence';
  else if ((txChange > 0 && accountChange <= 0) || (txChange <= 0 && accountChange > 0) || corr < 0) verdict = 'Not supported';
  return {
    verdict,
    summary: `Across ${comparison.days} matched days per window, transactions changed ${formatSignedPercent(txChange)} and active accounts changed ${formatSignedPercent(accountChange)}. Daily transaction/account correlation was r=${corr.toFixed(2)} (n=${correlation.n}).`,
    details: [
      'These are descriptive associations, not causal or predictive evidence.',
      'Active accounts are account identifiers, not verified people or a retention cohort.',
      'Verdict rule: both window changes must be positive and Pearson r ≥ 0.30 for support; opposing trends or negative correlation are not supported; other complete cases are partial.',
    ],
  };
}
