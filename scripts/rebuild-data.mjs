import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  alignMarketAndTvl,
  assessLiveRisks,
  testHypothesis,
  windowChange,
} from '../src/analytics.js';
import {
  DATA_SOURCES,
  fetchNeardataBlockTransactionCount,
  fetchCoinGeckoHistory,
  fetchCoinGeckoMarket,
  fetchDefiLlamaPrice,
  fetchFinalizedBlock,
  fetchRpcStatus,
  fetchTvlHistory,
  fetchValidatorSet,
} from '../src/data.js';
import { replayChartInputs, replayRpcObservations } from '../src/replay.js';
import { CHART_QUERY_RECIPES, THESIS_TEST_RECIPE } from '../src/query-registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function failedResult(sourceId, detail) {
  return { status: { sourceId, ok: false, checkedAt: new Date().toISOString(), providerAt: null, latencyMs: null, detail } };
}

export async function rebuildSnapshot() {
  const [block, market, marketChart, llamaPrice, tvl] = await Promise.all([
    fetchFinalizedBlock(),
    fetchCoinGeckoMarket(),
    fetchCoinGeckoHistory(),
    fetchDefiLlamaPrice(),
    fetchTvlHistory(),
  ]);
  const blockTransactions = block.value
    ? await fetchNeardataBlockTransactionCount(block.value)
    : failedResult('fastnear-neardata-block-transactions', 'Finalized block unavailable; no Neardata request was made.');

  // Keep these shared public RPC reads sequential and conservative.
  const rpcStatus = await fetchRpcStatus();
  const validators = await fetchValidatorSet();
  const results = { block, blockTransactions, market, marketChart, llamaPrice, tvl, rpcStatus, validators };
  const resultBySource = {
    'near-rpc-finalized': block,
    'fastnear-neardata-block-transactions': blockTransactions,
    'near-rpc-status': rpcStatus,
    'near-rpc-validators': validators,
    'coingecko-market': market,
    'coingecko-history': marketChart,
    'defillama-price': llamaPrice,
    'defillama-tvl': tvl,
  };
  const sourceStatuses = DATA_SOURCES.map((source) => resultBySource[source.id]?.status ?? failedResult(source.id, 'No source result was recorded.'));
  const generatedAt = new Date().toISOString();
  const daily = alignMarketAndTvl(tvl.value?.rows ?? [], marketChart.value ?? {}, generatedAt.slice(0, 10));
  let previousObservations = [];
  try {
    const previous = JSON.parse(await readFile(resolve(root, 'data/latest-evidence.json'), 'utf8'));
    previousObservations = previous.rawRpcObservationHistory ?? (previous.rawReturnedData?.finalizedBlock ? [{ observedAt: previous.generatedAt, rawBlock: previous.rawReturnedData.finalizedBlock }] : []);
  } catch { /* First build or unreadable previous evidence: never invent history. */ }
  const rawRpcObservationHistory = replayRpcObservations([...previousObservations, ...(block.value ? [{ observedAt: block.value.fetchedAt, rawBlock: block.value.raw, rawChunks: blockTransactions.value?.rawChunks ?? null, transactionFetchedAt: blockTransactions.value?.fetchedAt ?? null }] : [])]).slice(-60);
  const matchedWindows = Object.fromEntries([7, 14, 30].map((days) => [days, {
    tvlUsd: windowChange(daily, 'tvlUsd', days),
    priceUsd: windowChange(daily, 'priceUsd', days),
    grossMarketVolumeUsd: windowChange(daily, 'grossVolumeUsd', days),
  }]));
  const hypothesis = testHypothesis(daily, 'priceUsd', 'tvlUsd', 'positive', 14);
  const risks = assessLiveRisks({
    market: market.value ? { priceChange24h: market.value.priceChange24hPct, priceUsd: market.value.priceUsd, timestamp: market.value.timestamp } : null,
    tvl7d: matchedWindows[7].tvlUsd,
    tvl30d: matchedWindows[30].tvlUsd,
    validators: validators.value ?? null,
    block: block.value ? { ...block.value, ageSeconds: Math.max(0, (Date.now() - block.value.timestampMs) / 1000) } : null,
    rpcStatus: rpcStatus.value ?? null,
    blockActivity: blockTransactions.value ?? null,
  });
  const snapshot = {
    product: 'NEAR SIGNAL',
    generatedAt,
    mode: 'Observed public-source responses only; failed or unconfigured sources remain unavailable; no synthetic fallback',
    externalStatus: 'Existing public Vercel dashboard; no hackathon submission or public post made',
    sourceDefinitions: DATA_SOURCES,
    sourceStatuses,
    liveObservations: {
      finalizedBlock: block.value ?? null,
      sampledFinalizedBlockTransactions: blockTransactions.value ?? null,
      rpcStatus: rpcStatus.value ? {
        chainId: rpcStatus.value.chain_id,
        syncing: rpcStatus.value.syncing,
        latestBlockHeight: rpcStatus.value.sync_info?.latest_block_height ?? null,
        latestBlockTime: rpcStatus.value.sync_info?.latest_block_time ?? null,
      } : null,
      currentValidatorSet: validators.value ?? null,
      coinGeckoMarket: market.value ?? null,
      independentDefiLlamaSpot: llamaPrice.value ?? null,
      latestCompleteMatchedUtcDate: daily.at(-1)?.date ?? null,
    },
    dailyAlignedMarketAndTvl: daily,
    rawRpcObservationHistory,
    chartRebuildInputs: {
      overviewMarketTvl: daily,
      capitalTvlStock: daily.map(({ date, tvlUsd }) => ({ date, tvlUsd })),
      latestFinalizedBlockGas: block.value ?? null,
      latestCompleteBlockTransactionSample: blockTransactions.value ?? null,
      localGasAndBlockSampleHistory: 'Raw-response-backed observations are saved in this bundle and replayable offline. They are samples, not a historical chain archive.',
    },
    chartQueryRecipes: CHART_QUERY_RECIPES,
    thesisTestRecipe: THESIS_TEST_RECIPE,
    matchedWindows,
    selectedDescriptiveTest: {
      claimLabel: 'NEAR price and TVL daily changes move in the same direction',
      calculation: hypothesis,
      rule: 'Pearson r threshold ±0.30; requires the full selected consecutive sample; no p-value or causal interpretation',
      recipe: THESIS_TEST_RECIPE,
      sourceObservations: {
        'coingecko-history': { fetchedAt: marketChart.value?.fetchedAt ?? null, providerAt: marketChart.status?.providerAt ?? null },
        'defillama-tvl': { fetchedAt: tvl.value?.fetchedAt ?? null, providerAt: tvl.status?.providerAt ?? null },
      },
    },
    riskStates: risks,
    rawReturnedData: {
      finalizedBlock: block.value?.raw ?? null,
      defillamaTvlRows: tvl.value?.rows ?? null,
      coinGeckoMarketChart: marketChart.value ?? null,
    },
    limitations: [
      'The transaction count covers one finalized block sample. It is not a daily series, unique-user count, retention measure or adoption trend.',
      'Daily account cohorts, historical transaction/contract trends, verified people and returning-user retention are unavailable; no such metrics are inferred from a block sample.',
      'No canonical, deduplicated bridge or NEAR Intents net-flow history is connected.',
      'The validator summary covers the RPC-reported current active set, not all stakers or historical validator performance.',
      'One public RPC node status and browser-local observations do not establish network-wide uptime or security.',
      'Market capitalization and volume are aggregated exchange-market measures. TVL is a daily USD asset stock. Neither is net investment or protocol revenue.',
      'The selected correlation is descriptive only. It does not establish causation, statistical significance, independence or a forecast.',
      'Provider access, freshness, shared limits and endpoint availability can change. Successful access does not establish public/commercial permission or an SLA.',
    ],
  };

  snapshot.replayedChartInputs = replayChartInputs(snapshot);
  const output = resolve(root, 'data/latest-evidence.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const successful = sourceStatuses.filter((status) => status.ok === true).length;
  const unavailable = sourceStatuses.filter((status) => status.ok === false).length;
  return { snapshot, output, successful, unavailable, results };
}

const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  rebuildSnapshot().then(({ snapshot, output, successful, unavailable, results }) => {
    console.log(`Wrote ${output}`);
    console.log(`Observed ${successful}/${snapshot.sourceStatuses.length} connected feeds successfully; ${unavailable} failed.`);
    console.log(`Finalized block: ${results.block.value?.height ?? 'unavailable'}; complete block transaction count: ${results.blockTransactions.value?.transactionCount ?? 'unavailable'}; current validators: ${results.validators.value?.validatorCount ?? 'unavailable'}; matched market/TVL dates: ${snapshot.dailyAlignedMarketAndTvl.length}; full 30-day TVL window: ${snapshot.matchedWindows[30].tvlUsd ? 'available' : 'unavailable'}.`);
  }).catch((error) => {
    console.error(`Snapshot rebuild failed: ${error?.message || 'unexpected error'}`);
    process.exitCode = 1;
  });
}
