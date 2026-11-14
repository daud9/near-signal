import { alignMarketAndTvl, summarizeBlock, summarizeBlockTransactions, toUtcDate } from './analytics.js';

function finiteValue(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactChunkEvidence(chunks) {
  if (!Array.isArray(chunks)) return null;
  const compacted = [];
  for (const chunk of chunks) {
    if (!chunk?.header || !Array.isArray(chunk.transactions)) return null;
    if (chunk.transactions.some((transaction) => typeof transaction?.hash !== 'string' || !transaction.hash)) return null;
    compacted.push({
      header: {
        shard_id: chunk.header.shard_id,
        chunk_hash: chunk.header.chunk_hash,
        height_included: chunk.header.height_included,
      },
      transactions: chunk.transactions.map(({ hash }) => ({ hash })),
    });
  }
  return compacted;
}

// Summary-only legacy observations are deliberately excluded: every plotted RPC point
// must be reproducible from its retained raw block and (for counts) every newly
// included shard chunk; earlier-height references contribute zero.
export function replayRpcObservations(observations = []) {
  const byHeight = new Map();
  for (const observation of observations) {
    const observedMs = Date.parse(observation?.observedAt);
    if (!Number.isFinite(observedMs)) continue;
    const block = summarizeBlock(observation?.rawBlock, observedMs);
    if (!block) continue;
    const rawChunks = compactChunkEvidence(observation.rawChunks);
    const activity = summarizeBlockTransactions(block, rawChunks);
    byHeight.set(block.height, {
      ...observation, rawChunks, height: block.height, blockTime: block.timestamp,
      gasUsed: block.gasUsed, gasTgas: block.gasUsed / 1e12,
      estimatedGasFeeNear: block.estimatedGasFeeNear, activeChunks: block.activeChunks,
      transactionCount: activity?.transactionCount ?? null,
      transactionChunkCount: activity?.chunkCount ?? null,
      transactionShardCount: activity?.shardCount ?? null,
      transactionReusedShardCount: activity?.reusedShardCount ?? null,
    });
  }
  return [...byHeight.values()].sort((a, b) => a.height - b.height);
}

export function replayChartInputs(bundle) {
  const asOf = bundle?.exportedAt ?? bundle?.generatedAt;
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('A dated evidence bundle is required');
  const cutoffUtc = asOf.slice(0, 10);
  const tvl = bundle.rawTvlRows ?? bundle.rawReturnedData?.defillamaTvlRows ?? [];
  const market = bundle.rawCoinGeckoMarketChart ?? bundle.rawReturnedData?.coinGeckoMarketChart ?? {};
  const daily = alignMarketAndTvl(tvl, market, cutoffUtc);
  const fullTvl = (Array.isArray(tvl) ? tvl : []).map((row) => ({ date: toUtcDate(row?.date, 's'), tvlUsd: finiteValue(row?.tvl) }))
    .filter((row) => row.date && row.date < cutoffUtc && row.tvlUsd !== null && row.tvlUsd >= 0).sort((a, b) => a.date.localeCompare(b.date));
  const rawDex = bundle.rawNearDexVolumeRows ?? bundle.rawReturnedData?.nearDexVolumeHistory?.rows ?? bundle.live?.nearDexVolumeHistory?.rows ?? [];
  const rawFees = bundle.rawNearFeeRows ?? bundle.rawReturnedData?.nearFeeHistory?.rows ?? bundle.live?.nearFeeHistory?.rows ?? [];
  const datedUsd = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({ date: String(row?.date ?? '').slice(0, 10), valueUsd: finiteValue(row?.valueUsd) }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date < cutoffUtc && row.valueUsd !== null && row.valueUsd >= 0).sort((a, b) => a.date.localeCompare(b.date));
  const dexRows = datedUsd(rawDex), feeRows = datedUsd(rawFees);
  const observations = replayRpcObservations(bundle.localRpcObservationHistory ?? bundle.rawRpcObservationHistory ?? []);
  const selections = bundle.chartSelections ?? { days: 14, metric: 'priceUsd' };
  const days = [7, 14, 30].includes(Number(selections.days)) ? Number(selections.days) : 14;
  const metric = ['priceUsd', 'tvlUsd', 'grossVolumeUsd'].includes(selections.metric) ? selections.metric : 'priceUsd';
  const selectedRows = daily.slice(-(days + 1));
  const capitalDays = [7, 14, 30, 90, 365].includes(Number(selections.capitalDays)) ? Number(selections.capitalDays) : 365;
  return {
    asOf, cutoffUtc,
    selections: { days, metric, capitalDays },
    overviewChart: daily,
    overviewPlot: selectedRows.map((row) => ({ date: row.date, value: row[metric] })),
    capitalChart: fullTvl.slice(-(capitalDays + 1)),
    dexVolumeChart: dexRows.slice(-365),
    feeHistoryChart: feeRows.slice(-365),
    gasChart: observations.map(({ observedAt, height, gasTgas }) => ({ observedAt, height, gasTgas })),
    blockTxChart: observations.filter((row) => Number.isSafeInteger(row.transactionCount)).map(({ observedAt, height, transactionCount }) => ({ observedAt, height, transactionCount })),
    note: 'No network requests. Values are recomputed from raw inputs using the original UTC cutoff. TVL is replayed as its own long daily history; DEX and fee rows remain provider-indexed and gaps are not filled. Empty arrays remain empty; summary-only legacy points are excluded. RPC observations are samples, not a historical chain archive.',
  };
}
