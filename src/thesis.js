import { THESIS_TEST_RECIPE } from './query-registry.js';

export function createThesisTestEvidence({
  exportedAt = new Date().toISOString(),
  hypothesis,
  metricA,
  metricB,
  direction,
  days,
  result,
  dailyInputs,
  rawCoinGeckoMarketChart,
  rawTvlRows,
  sourceObservations,
  sources,
  sourceStatuses,
}) {
  return {
    schemaVersion: 1,
    project: 'NEAR SIGNAL',
    exportedAt,
    hypothesis,
    selection: { metricA, metricB, direction, days },
    result,
    dailyInputs,
    rawInputs: {
      coinGeckoMarketChart: rawCoinGeckoMarketChart,
      defillamaTvlRows: rawTvlRows,
    },
    provenance: {
      recipe: THESIS_TEST_RECIPE,
      sourceObservations,
      sources,
      sourceStatuses,
    },
    limitations: THESIS_TEST_RECIPE.limitations,
  };
}
