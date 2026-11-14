export const DEFAULT_ALERT_DECLINE_PCT = 20;
export const DEFAULT_BLOCK_STALE_SECONDS = 30;
const YOCTO_PER_NEAR = 1e24;

export function toUtcDate(value, unit = 'ms') {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsedDate = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value ? null : value;
  }
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const millis = unit === 'ns' ? numeric / 1e6 : unit === 's' ? numeric * 1e3 : numeric;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dailyValues(points = []) {
  const values = new Map();
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const date = toUtcDate(point[0], 'ms');
    const value = numeric(point[1]);
    if (date && value !== null) values.set(date, value);
  }
  return values;
}

export function alignMarketAndTvl(tvlRows = [], marketChart = {}, todayUtc = new Date().toISOString().slice(0, 10)) {
  const tvl = new Map();
  for (const row of tvlRows) {
    const date = toUtcDate(row?.date, 's');
    const value = numeric(row?.tvl);
    if (date && value !== null) tvl.set(date, value);
  }
  const prices = dailyValues(marketChart?.prices);
  const marketCaps = dailyValues(marketChart?.market_caps);
  const volumes = dailyValues(marketChart?.total_volumes);
  return [...tvl.keys()]
    .filter((date) => date < todayUtc && prices.has(date))
    .sort()
    .map((date) => ({
      date,
      tvlUsd: tvl.get(date),
      priceUsd: prices.get(date),
      marketCapUsd: marketCaps.get(date) ?? null,
      grossVolumeUsd: volumes.get(date) ?? null,
    }));
}

export function summarizeBlock(block, nowMs = Date.now()) {
  const header = block?.header;
  if (!header || !Array.isArray(block?.chunks)) return null;
  const height = numeric(header.height);
  if (!Number.isSafeInteger(height) || height < 0) return null;
  const timestampNs = numeric(header.timestamp);
  if (timestampNs === null || timestampNs <= 0) return null;
  if (header.gas_price === null || header.gas_price === undefined || block.chunks.some((chunk) => chunk?.gas_used === null || chunk?.gas_used === undefined || chunk?.gas_limit === null || chunk?.gas_limit === undefined)) return null;
  const parseBigInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
    if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
    try { const parsed = BigInt(value); return parsed >= 0n ? parsed : null; } catch { return null; }
  };
  const gasUsedParts = block.chunks.map((chunk) => parseBigInt(chunk?.gas_used));
  const gasLimitParts = block.chunks.map((chunk) => parseBigInt(chunk?.gas_limit));
  const gasPriceRaw = parseBigInt(header.gas_price);
  if (gasPriceRaw === null || gasUsedParts.some((value) => value === null) || gasLimitParts.some((value) => value === null)) return null;
  if (gasUsedParts.some((value, index) => value > gasLimitParts[index])) return null;
  const gasUsedRaw = gasUsedParts.reduce((sum, value) => sum + value, 0n);
  const gasLimitRaw = gasLimitParts.reduce((sum, value) => sum + value, 0n);
  const gasUsed = Number(gasUsedRaw);
  const gasLimit = Number(gasLimitRaw);
  const gasPrice = Number(gasPriceRaw);
  const blockTimeMs = timestampNs / 1e6;
  if (!Number.isFinite(blockTimeMs) || !Number.isFinite(gasUsed) || !Number.isFinite(gasLimit) || !Number.isFinite(gasPrice)) return null;
  const activeChunks = gasUsedParts.filter((value) => value > 0n).length;
  const feeYocto = gasUsedRaw * gasPriceRaw;
  return {
    height,
    hash: header.hash ?? null,
    epochId: header.epoch_id ?? null,
    protocolVersion: header.latest_protocol_version ?? null,
    timestamp: new Date(blockTimeMs).toISOString(),
    timestampMs: blockTimeMs,
    ageSeconds: Math.max(0, (nowMs - blockTimeMs) / 1000),
    chunkCount: block.chunks.length,
    chunkRefs: block.chunks.map((chunk) => ({ chunkHash: chunk?.chunk_hash ?? null, shardId: numeric(chunk?.shard_id), heightCreated: numeric(chunk?.height_created), heightIncluded: numeric(chunk?.height_included) })),
    activeChunks,
    gasUsed,
    gasLimit,
    gasUtilizationPct: gasLimit > 0 ? gasUsed / gasLimit * 100 : null,
    gasPriceYocto: gasPriceRaw.toString(),
    gasPriceNearPerTgas: gasPrice * 1e12 / YOCTO_PER_NEAR,
    gasFeeYocto: feeYocto.toString(),
    estimatedGasFeeNear: Number(feeYocto) / YOCTO_PER_NEAR,
  };
}

export function summarizeBlockTransactions(block, chunkResults) {
  const blockHeight = numeric(block?.height);
  const refs = block?.chunkRefs;
  if (!Number.isSafeInteger(blockHeight) || typeof block?.hash !== 'string' || !block.hash || !Number.isFinite(Date.parse(block.timestamp)) || !Array.isArray(refs) || refs.length === 0 || !Array.isArray(chunkResults) || chunkResults.length !== refs.length) return null;
  const seenShards = new Set();
  const chunks = [];
  for (const ref of refs) {
    const shardId = numeric(ref?.shardId);
    if (shardId === null || !Number.isSafeInteger(shardId) || seenShards.has(shardId) || typeof ref?.chunkHash !== 'string') return null;
    seenShards.add(shardId);
    const match = chunkResults.find((chunk) => numeric(chunk?.header?.shard_id) === shardId);
    if (!match || !Array.isArray(match.transactions) || match.header?.chunk_hash !== ref.chunkHash) return null;
    if (match.transactions.some((transaction) => typeof transaction?.hash !== 'string' || !transaction.hash)) return null;
    const includedHeight = numeric(match.header.height_included);
    const expectedHeight = numeric(ref.heightIncluded) ?? blockHeight;
    if (includedHeight !== expectedHeight) return null;
    chunks.push({ shardId, chunkHash: ref.chunkHash, transactionCount: match.transactions.length });
  }
  if (chunks.length !== seenShards.size) return null;
  return {
    blockHeight,
    blockHash: block.hash ?? null,
    blockTimestamp: block.timestamp ?? null,
    transactionCount: chunks.reduce((sum, chunk) => sum + chunk.transactionCount, 0),
    chunkCount: chunks.length,
    chunks,
  };
}

export function summarizeNeardataBlockTransactions(requestedBlock, payload) {
  const header = payload?.block?.header;
  const refs = payload?.block?.chunks;
  const expectedRefs = requestedBlock?.chunkRefs;
  const height = numeric(header?.height);
  if (!Number.isSafeInteger(height) || height !== requestedBlock?.height || header?.hash !== requestedBlock?.hash ||
      !Array.isArray(refs) || !Array.isArray(expectedRefs) || refs.length === 0 || refs.length !== expectedRefs.length ||
      !Array.isArray(payload?.shards) || payload.shards.length !== refs.length) return null;

  const refByShard = new Map();
  for (const ref of refs) {
    const shardId = numeric(ref?.shard_id);
    if (!Number.isSafeInteger(shardId) || shardId < 0 || typeof ref?.chunk_hash !== 'string' || !ref.chunk_hash || refByShard.has(shardId)) return null;
    refByShard.set(shardId, ref);
  }
  const shardById = new Map();
  for (const shard of payload.shards) {
    const shardId = numeric(shard?.shard_id);
    if (!Number.isSafeInteger(shardId) || shardId < 0 || shardById.has(shardId)) return null;
    shardById.set(shardId, shard);
  }

  const chunks = [];
  const rawChunks = [];
  for (const expected of expectedRefs) {
    const shardId = numeric(expected?.shardId);
    const ref = refByShard.get(shardId);
    const expectedHeight = numeric(expected?.heightIncluded);
    if (!Number.isSafeInteger(shardId) || !ref || ref.chunk_hash !== expected.chunkHash ||
        (expectedHeight !== null && numeric(ref.height_included) !== expectedHeight)) return null;
    const chunk = shardById.get(shardId)?.chunk;
    const chunkHeader = chunk?.header;
    const transactions = chunk?.transactions;
    if (chunkHeader?.chunk_hash !== ref.chunk_hash || numeric(chunkHeader.height_included) !== numeric(ref.height_included) ||
        !Array.isArray(transactions) || transactions.some((item) => typeof item?.transaction?.hash !== 'string' || !item.transaction.hash)) return null;
    chunks.push({ shardId, chunkHash: ref.chunk_hash, transactionCount: transactions.length });
    rawChunks.push({
      header: { shard_id: shardId, chunk_hash: ref.chunk_hash, height_included: numeric(ref.height_included) },
      transactions: transactions.map((item) => ({ hash: item.transaction.hash })),
    });
  }
  return {
    blockHeight: height,
    blockHash: header.hash,
    blockTimestamp: requestedBlock.timestamp,
    transactionCount: chunks.reduce((sum, chunk) => sum + chunk.transactionCount, 0),
    chunkCount: chunks.length,
    chunks,
    rawChunks,
  };
}

export function summarizeValidators(validatorResult) {
  const validators = validatorResult?.current_validators;
  if (!Array.isArray(validators) || validators.length === 0) return null;
  let totalStake = 0n;
  const rows = [];
  let producedBlocks = 0;
  let expectedBlocks = 0;
  let allProductionCountersValid = true;
  for (const validator of validators) {
    if (typeof validator?.account_id !== 'string' || !validator.account_id || validator.stake === null || validator.stake === undefined || validator.stake === '') return null;
    let stake;
    try {
      if (typeof validator.stake === 'number' && !Number.isSafeInteger(validator.stake)) return null;
      if (typeof validator.stake === 'string' && !/^\d+$/.test(validator.stake)) return null;
      stake = BigInt(validator.stake);
    } catch { return null; }
    if (stake < 0n) return null;
    totalStake += stake;
    rows.push({ accountId: validator.account_id, stake });
    const produced = numeric(validator.num_produced_blocks), expected = numeric(validator.num_expected_blocks);
    if (produced === null || expected === null || !Number.isSafeInteger(produced) || !Number.isSafeInteger(expected) || produced < 0 || expected < 0) allProductionCountersValid = false;
    else { producedBlocks += produced; expectedBlocks += expected; }
  }
  if (!rows.length || totalStake === 0n) return null;
  const ratioScale = 1_000_000_000_000n;
  const shares = rows.map((row) => Number(row.stake * ratioScale / totalStake) / Number(ratioScale)).sort((a, b) => b - a);
  return {
    epochHeight: numeric(validatorResult.epoch_height),
    epochStartHeight: numeric(validatorResult.epoch_start_height),
    validatorCount: rows.length,
    nextValidatorCount: Array.isArray(validatorResult.next_validators) ? validatorResult.next_validators.length : null,
    totalStakeNear: Number(totalStake) / YOCTO_PER_NEAR,
    top1SharePct: shares.length ? shares[0] * 100 : null,
    top10SharePct: shares.length ? shares.slice(0, 10).reduce((sum, value) => sum + value, 0) * 100 : null,
    hhi: shares.reduce((sum, share) => sum + share ** 2 * 10_000, 0),
    producedBlocks: allProductionCountersValid ? producedBlocks : null,
    expectedBlocks: allProductionCountersValid ? expectedBlocks : null,
    blockProductionPct: allProductionCountersValid && expectedBlocks > 0 ? producedBlocks / expectedBlocks * 100 : null,
    asOf: new Date().toISOString(),
  };
}

function consecutiveDates(rows) {
  for (let index = 1; index < rows.length; index += 1) {
    const elapsed = (Date.parse(`${rows[index].date}T00:00:00Z`) - Date.parse(`${rows[index - 1].date}T00:00:00Z`)) / 86_400_000;
    if (elapsed !== 1) return false;
  }
  return true;
}

export function windowChange(rows, key, days) {
  if (!Array.isArray(rows) || rows.length < days + 1) return null;
  const windowRows = rows.slice(-(days + 1));
  if (!consecutiveDates(windowRows)) return null;
  const last = windowRows.at(-1);
  const first = windowRows[0];
  if (!last?.date || !first?.date || numeric(last[key]) === null || numeric(first[key]) === null || Number(first[key]) === 0) return null;
  const elapsed = (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 86_400_000;
  if (elapsed !== days) return null;
  return { days, startDate: first.date, endDate: last.date, startValue: Number(first[key]), endValue: Number(last[key]), changePct: (Number(last[key]) - Number(first[key])) / Math.abs(Number(first[key])) * 100 };
}

export function dailyChangeRows(rows, key) {
  const output = [];
  for (let index = 1; index < (rows?.length ?? 0); index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    const beforeValue = numeric(before?.[key]);
    const afterValue = numeric(after?.[key]);
    const dateGap = (Date.parse(`${after?.date}T00:00:00Z`) - Date.parse(`${before?.date}T00:00:00Z`)) / 86_400_000;
    if (dateGap !== 1 || beforeValue === null || afterValue === null || beforeValue === 0) continue;
    output.push({ date: after.date, value: (afterValue - beforeValue) / Math.abs(beforeValue) * 100 });
  }
  return output;
}

export function pearsonCorrelation(rows, keyA, keyB) {
  const pairs = (rows ?? []).map((row) => [numeric(row?.[keyA]), numeric(row?.[keyB])]).filter(([a, b]) => a !== null && b !== null);
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
    varianceA += da ** 2;
    varianceB += db ** 2;
  }
  if (!varianceA || !varianceB) return { n: pairs.length, r: null };
  return { n: pairs.length, r: covariance / Math.sqrt(varianceA * varianceB) };
}

export function testHypothesis(rows, metricA, metricB, expectedDirection = 'positive', days = 14) {
  const a = dailyChangeRows(rows, metricA);
  const b = new Map(dailyChangeRows(rows, metricB).map((row) => [row.date, row.value]));
  const matched = a.filter((row) => b.has(row.date)).map((row) => ({ date: row.date, a: row.value, b: b.get(row.date) })).slice(-days);
  const correlation = pearsonCorrelation(matched, 'a', 'b');
  if (matched.length !== days || !consecutiveDates(matched) || correlation.r === null) {
    return { verdict: 'Insufficient evidence', r: null, n: correlation.n, startDate: matched[0]?.date ?? null, endDate: matched.at(-1)?.date ?? null, expectedDirection, summary: 'There are too few complete, consecutive daily changes or one series is constant. No verdict is calculated.' };
  }
  const matchesExpectation = expectedDirection === 'negative' ? correlation.r <= -0.3 : correlation.r >= 0.3;
  const contradictsExpectation = expectedDirection === 'negative' ? correlation.r >= 0.3 : correlation.r <= -0.3;
  const verdict = matchesExpectation ? 'Supported by available evidence' : contradictsExpectation ? 'Not supported' : 'Partially supported';
  return {
    verdict,
    r: correlation.r,
    n: correlation.n,
    startDate: matched[0].date,
    endDate: matched.at(-1).date,
    expectedDirection,
    summary: `Pearson r=${correlation.r.toFixed(2)} across ${correlation.n} matched daily changes (${matched[0].date} to ${matched.at(-1).date}). The declared rule treats |r| ≥ 0.30 in the expected direction as support. This is descriptive co-movement, not causation or a significance test.`,
  };
}

export function assessLiveRisks({ market, tvl7d, tvl30d, validators, block, rpcStatus, blockActivity, declineThreshold = DEFAULT_ALERT_DECLINE_PCT, staleBlockSeconds = DEFAULT_BLOCK_STALE_SECONDS }) {
  const threshold = Math.max(5, Math.min(50, Number(declineThreshold) || DEFAULT_ALERT_DECLINE_PCT));
  const tvlDecline = numeric(tvl30d?.changePct);
  const priceMove = numeric(market?.priceChange24h);
  const blockTxCount = numeric(blockActivity?.transactionCount);
  const blockTxHeight = numeric(blockActivity?.blockHeight);
  const blockAge = numeric(block?.ageSeconds);
  const rpcAvailable = Boolean(block && rpcStatus?.chain_id === 'mainnet');
  return [
    {
      id: 'concentration', title: 'Validator stake concentration',
      state: validators ? 'Current set observed' : 'Data unavailable',
      tone: 'neutral', severity: 'Unrated — no validated risk threshold',
      trend: 'One current-epoch validator set; prior epochs are not yet collected.',
      confidence: validators ? 'High for RPC-reported active-set stakes; does not represent all stakers or ecosystem apps' : 'Insufficient evidence',
      evidence: validators ? `${validators.validatorCount} current validators; top 10 hold ${validators.top10SharePct.toFixed(1)}% of stake in the reported set (HHI ${validators.hhi.toFixed(0)}).` : 'The current validator set was not returned.',
      impact: 'Validator stake concentration is a governance and production-dependency indicator, not proof of collusion or a security failure.',
      next: 'Compare multiple epochs and add independently sourced application/contract concentration before broadening this risk.',
    },
    {
      id: 'adoption', title: 'Network activity / adoption quality',
      state: blockTxCount !== null ? 'Block transactions observed · adoption unmeasured' : 'Not measured', tone: 'caution',
      severity: blockTxCount !== null ? 'Unrated — one finalized-block count cannot establish user adoption' : 'Unrated — no sampled finalized-block transaction count; daily account history is unavailable',
      trend: blockTxCount !== null ? `One finalized block sample: ${Math.round(blockTxCount).toLocaleString()} transactions across ${blockActivity.chunkCount} shard chunks; no daily or unique-user trend.` : 'Unavailable — no complete sampled finalized-block transaction count or daily account series is connected.',
      confidence: blockTxCount !== null ? 'High for the returned transaction arrays in this block; insufficient for adoption, retention or a trend' : 'Insufficient evidence',
      evidence: blockTxCount !== null ? `${Math.round(blockTxCount).toLocaleString()} transactions across ${blockActivity.chunkCount} shard chunks in finalized block ${blockTxHeight?.toLocaleString() ?? '—'} (${blockActivity.blockTimestamp ?? 'time unavailable'}). Transaction identities are not retained.` : 'No complete sampled per-block transaction count or daily account history is available.',
      impact: 'A block-local transaction count indicates activity in one sample; it does not identify users, returning behaviour, application diversity or adoption quality.',
      next: 'Collect a permitted consecutive block series, then add independently authorized account cohorts, retention and application-diversity evidence.',
    },
    {
      id: 'capital', title: 'Liquidity stock (TVL)',
      state: tvlDecline === null ? 'Daily TVL unavailable' : tvlDecline <= -threshold ? 'Drawdown watch' : 'Daily TVL observed',
      tone: tvlDecline !== null && tvlDecline <= -threshold ? 'high' : 'neutral',
      severity: tvlDecline === null ? 'Unrated — no current TVL window' : tvlDecline <= -threshold ? `Configured signal — ${threshold}% 30-day decline threshold crossed` : 'No configured 30-day TVL decline threshold crossed',
      trend: tvlDecline === null ? 'Unavailable — TVL history did not produce a complete 30-day comparison.' : `DefiLlama-reported NEAR DeFi TVL changed ${tvlDecline > 0 ? '+' : ''}${tvlDecline.toFixed(1)}% over ${tvl30d.days} days.`,
      confidence: tvlDecline === null ? 'Insufficient evidence' : 'Moderate for provider-reported USD TVL; low for net flows or capital retention',
      evidence: tvlDecline === null ? 'No complete daily TVL comparison is available.' : 'TVL is an indexed asset stock and is affected by token prices. It is not a bridge flow, net inflow or retained investment.',
      impact: 'A sustained fall in TVL can indicate lower reported DeFi balances, but price changes and coverage changes may explain part of it.',
      next: 'Check underlying assets, protocol coverage and price-adjusted changes before calling a TVL move an ecosystem capital flow.',
    },
    {
      id: 'infrastructure', title: 'Infrastructure freshness',
      state: !rpcAvailable ? 'RPC observation unavailable' : rpcStatus.syncing ? 'Node reports syncing' : blockAge > staleBlockSeconds ? 'Finalized block is stale' : 'Finalized block observed',
      tone: !rpcAvailable || rpcStatus?.syncing || blockAge > staleBlockSeconds ? 'caution' : 'positive',
      severity: !rpcAvailable ? 'Unrated — no current RPC result' : rpcStatus?.syncing || blockAge > staleBlockSeconds ? 'Operational warning on this endpoint only' : 'No single-check warning observed',
      trend: 'A live point-in-time RPC view; local history only accumulates while this browser remains open.',
      confidence: rpcAvailable ? 'High for the returned block/status; low for global network health or uptime' : 'Insufficient evidence',
      evidence: rpcAvailable ? `Finalized block ${Number(block.height).toLocaleString()} is ${blockAge.toFixed(1)} seconds old; queried node syncing=${Boolean(rpcStatus.syncing)}.` : 'The mainnet RPC did not return both status and a finalized block.',
      impact: 'This can reveal an old block or syncing node view, but one provider cannot establish a network-wide outage or consensus fault.',
      next: 'Compare multiple independent RPC providers and keep a persistent observation history before making availability claims.',
    },
    {
      id: 'economics', title: 'Economic signal',
      state: priceMove === null ? 'Market change unavailable' : priceMove <= -threshold ? 'Price decline watch' : 'Market snapshot observed',
      tone: priceMove !== null && priceMove <= -threshold ? 'high' : 'neutral',
      severity: priceMove === null ? 'Unrated — no current market change' : priceMove <= -threshold ? `Configured signal — ${threshold}% 24-hour market decline threshold crossed` : 'No configured 24-hour market decline threshold crossed',
      trend: priceMove === null ? 'Unavailable — provider did not return a fresh 24-hour percentage change.' : `CoinGecko aggregated NEAR price changed ${priceMove > 0 ? '+' : ''}${priceMove.toFixed(2)}% over 24 hours.`,
      confidence: priceMove === null ? 'Insufficient evidence' : 'Moderate for aggregated market data; not protocol value capture',
      evidence: block && block.estimatedGasFeeNear !== null ? `Latest finalized block used ${(block.gasUsed / 1e12).toFixed(2)} Tgas; estimated gas cost ${block.estimatedGasFeeNear.toFixed(6)} Ⓝ. This is not protocol revenue.` : 'No latest finalized-block gas estimate is available.',
      impact: 'Market repricing and per-block execution cost are separate observations; neither establishes sustainable token value capture.',
      next: 'Add a permitted historical fee series and protocol-level token-economic context before assessing long-run value capture.',
    },
    {
      id: 'dependencies', title: 'Ecosystem dependencies',
      state: 'Not assessed', tone: 'caution', severity: 'Unrated — no dependency inventory',
      trend: 'Not available — no verified protocol, bridge or critical-service dependency history is connected.',
      confidence: 'Insufficient evidence',
      evidence: 'No sourced inventory of major applications, liquidity providers, bridges or infrastructure operators is integrated.',
      impact: 'Critical external-service or protocol concentration could create risk that this live-feed MVP does not map.',
      next: 'Build a cited dependency register and connect it to an authorized incident and liquidity dataset.',
    },
  ];
}

export function formatSignedPercent(value, digits = 1) {
  const parsed = numeric(value);
  return parsed === null ? 'Unavailable' : `${parsed > 0 ? '+' : ''}${parsed.toFixed(digits)}%`;
}
