import { BIGQUERY_ACTIVITY_QUERY } from './query-registry.js';

export const WORKSPACES = {
  overview: { title: 'Market overview', description: 'NEAR mainnet, market and liquidity signals in one workspace.' },
  'value-capture': { title: 'Value Capture Lab', description: 'Inspect execution costs and model fees against the live gas price.' },
  adoption: { title: 'Organic Adoption Intelligence', description: 'Inspect live accounts, verified block samples and daily activity query recipes.' },
  'risk-radar': { title: 'Ecosystem Risk Radar', description: 'Screen current evidence with transparent thresholds and source-level coverage.' },
  'capital-flows': { title: 'Capital Flow Intelligence', description: 'Analyze liquidity stock changes; reconciled cross-chain flows remain unavailable.' },
  'thesis-challenge': { title: 'Thesis Challenge Engine', description: 'Test a declared relationship against complete, matched daily observations.' },
  methodology: { title: 'Sources & methodology', description: 'Inspect source availability, raw queries, definitions and evidence exports.' },
};

export function resolveWorkspace(hash) {
  const route = String(hash || '').replace(/^#/, '');
  return Object.hasOwn(WORKSPACES, route) ? route : 'overview';
}

export function isNearAccountId(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value);
}

function isUtcDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function buildActivitySql({ startDate, endDate, contractId }) {
  if (!isUtcDate(startDate) || !isUtcDate(endDate)) throw new Error('Choose valid UTC start and end dates.');
  const spanDays = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  if (spanDays < 1 || spanDays > 31) throw new Error('Choose an inclusive range of 1–31 days. No query is executed here.');
  if (!isNearAccountId(contractId)) throw new Error('Enter a valid lowercase NEAR contract account ID.');
  const exclusiveEndDate = new Date(Date.parse(endDate) + 86_400_000).toISOString().slice(0, 10);
  const declarations = `-- Generated locally. Review estimated bytes and obtain spending approval before running.\nDECLARE start_date DATE DEFAULT DATE '${startDate}';\nDECLARE end_date DATE DEFAULT DATE '${exclusiveEndDate}';\nDECLARE contract_account_id STRING DEFAULT '${contractId}';\n\n`;
  return declarations + BIGQUERY_ACTIVITY_QUERY.replaceAll('@start_date', 'start_date').replaceAll('@end_date', 'end_date').replaceAll('@contract_account_id', 'contract_account_id');
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
