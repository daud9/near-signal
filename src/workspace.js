export const WORKSPACES = {
  overview: { title: 'Market overview', description: 'NEAR mainnet, market and liquidity signals in one workspace.' },
  'thesis-challenge': { title: 'Thesis Challenge Engine', description: 'Test a declared relationship against complete, matched daily observations.' },
  'risk-radar': { title: 'Ecosystem Risk Radar', description: 'Screen current live signals with transparent thresholds and source status.' },
  'value-capture': { title: 'Value Capture Lab', description: 'Inspect execution costs and model fees against the live gas price.' },
  adoption: { title: 'Network Activity & Validators', description: 'Inspect live account state, current validators and verified finalized-block activity.' },
  'capital-flows': { title: 'Liquidity & TVL Context', description: 'Track matched daily NEAR DeFi TVL snapshots and their market context.' },
};

export function resolveWorkspace(hash) {
  const route = String(hash || '').replace(/^#/, '');
  return Object.hasOwn(WORKSPACES, route) ? route : 'overview';
}

export function isNearAccountId(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value);
}

export function estimateExecutionCost(gasTgas, gasPriceNearPerTgas, priceUsd) {
  const gas = Number(gasTgas);
  if (!Number.isFinite(gas) || gas <= 0 || gas > 300) return null;
  if (!Number.isFinite(gasPriceNearPerTgas) || gasPriceNearPerTgas <= 0) return null;
  const near = gas * gasPriceNearPerTgas;
  return { gasTgas: gas, near, usd: Number.isFinite(priceUsd) && priceUsd > 0 ? near * priceUsd : null };
}

export function toCsv(points, valueLabel = 'value') {
  const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [['observed_at_utc', valueLabel], ...points.map((point) => [point.date, point.value])].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}
