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
  if (!Number.isSafeInteger(blockHeight) || typeof block?.hash !== 'string' || !block.hash || !Number.isFinite(Date.parse(block.timestamp)) || !Array.isArray(refs) || refs.length === 0 || !Array.isArray(chunkResults)) return null;
  const returnedChunks = new Map();
  for (const chunk of chunkResults) {
    const shardId = numeric(chunk?.header?.shard_id);
    if (!Number.isSafeInteger(shardId) || shardId < 0 || returnedChunks.has(shardId) || !refs.some((ref) => numeric(ref?.shardId) === shardId)) return null;
    returnedChunks.set(shardId, chunk);
  }
  const referencedShards = new Set();
  const chunks = [];
  let includedChunkCount = 0;
  let reusedShardCount = 0;
  for (const ref of refs) {
    const shardId = numeric(ref?.shardId);
    if (shardId === null || !Number.isSafeInteger(shardId) || shardId < 0 || referencedShards.has(shardId) || typeof ref?.chunkHash !== 'string' || !ref.chunkHash) return null;
    referencedShards.add(shardId);
    const expectedHeight = numeric(ref.heightIncluded) ?? blockHeight;
    if (expectedHeight > blockHeight) return null;
    const match = returnedChunks.get(shardId);
    if (expectedHeight < blockHeight) {
      if (match && (match.header?.chunk_hash !== ref.chunkHash || numeric(match.header.height_included) !== expectedHeight)) return null;
      reusedShardCount += 1;
      chunks.push({ shardId, chunkHash: ref.chunkHash, transactionCount: 0 });
      continue;
    }
    if (!match || !Array.isArray(match.transactions) || match.header?.chunk_hash !== ref.chunkHash) return null;
    if (match.transactions.some((transaction) => typeof transaction?.hash !== 'string' || !transaction.hash)) return null;
    const includedHeight = numeric(match.header.height_included);
    if (includedHeight !== expectedHeight) return null;
    includedChunkCount += 1;
    chunks.push({ shardId, chunkHash: ref.chunkHash, transactionCount: match.transactions.length });
  }
  if (chunks.length !== referencedShards.size) return null;
  return {
    blockHeight,
    blockHash: block.hash ?? null,
    blockTimestamp: block.timestamp ?? null,
    transactionCount: chunks.reduce((sum, chunk) => sum + chunk.transactionCount, 0),
    chunkCount: includedChunkCount,
    shardCount: chunks.length,
    reusedShardCount,
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
      !Array.isArray(payload?.shards)) return null;

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
  for (const shardId of shardById.keys()) if (!refByShard.has(shardId)) return null;

  const chunks = [];
  const rawChunks = [];
  let includedChunkCount = 0;
  let reusedShardCount = 0;
  for (const expected of expectedRefs) {
    const shardId = numeric(expected?.shardId);
    const ref = refByShard.get(shardId);
    const expectedHeight = numeric(expected?.heightIncluded);
    if (!Number.isSafeInteger(shardId) || !ref || ref.chunk_hash !== expected.chunkHash || expectedHeight === null ||
        expectedHeight > height || numeric(ref.height_included) !== expectedHeight) return null;
    if (expectedHeight < height) {
      const oldChunk = shardById.get(shardId)?.chunk;
      if (oldChunk && (oldChunk.header?.chunk_hash !== ref.chunk_hash || numeric(oldChunk.header.height_included) !== expectedHeight)) return null;
      reusedShardCount += 1;
      chunks.push({ shardId, chunkHash: ref.chunk_hash, transactionCount: 0 });
      continue;
    }
    const chunk = shardById.get(shardId)?.chunk;
    const chunkHeader = chunk?.header;
    const transactions = chunk?.transactions;
    if (chunkHeader?.chunk_hash !== ref.chunk_hash || numeric(chunkHeader.height_included) !== numeric(ref.height_included) ||
        !Array.isArray(transactions) || transactions.some((item) => typeof item?.transaction?.hash !== 'string' || !item.transaction.hash)) return null;
    includedChunkCount += 1;
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
    chunkCount: includedChunkCount,
    shardCount: chunks.length,
    reusedShardCount,
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
  let slashedValidatorCount = 0;
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
    if (validator.is_slashed === true) slashedValidatorCount += 1;
    const produced = numeric(validator.num_produced_blocks), expected = numeric(validator.num_expected_blocks);
    if (produced === null || expected === null || !Number.isSafeInteger(produced) || !Number.isSafeInteger(expected) || produced < 0 || expected < 0) allProductionCountersValid = false;
    else { producedBlocks += produced; expectedBlocks += expected; }
  }
  if (!rows.length || totalStake === 0n) return null;
  const ratioScale = 1_000_000_000_000n;
  const shares = rows.map((row) => Number(row.stake * ratioScale / totalStake) / Number(ratioScale)).sort((a, b) => b - a);
  const prevEpochKickouts = Array.isArray(validatorResult.prev_epoch_kickout)
    ? validatorResult.prev_epoch_kickout.filter((item) => typeof item?.account_id === 'string' && item.account_id).map((item) => {
      const reasonValue = item.reason;
      const reasonEntry = reasonValue && typeof reasonValue === 'object' ? Object.entries(reasonValue)[0] : null;
      const reasonDetail = reasonEntry?.[1] && typeof reasonEntry[1] === 'object' ? reasonEntry[1] : {};
      return {
        accountId: item.account_id,
        reason: reasonEntry?.[0] ?? (typeof reasonValue === 'string' ? reasonValue : 'Unspecified kickout reason'),
        expected: numeric(reasonDetail.expected),
        produced: numeric(reasonDetail.produced),
      };
    })
    : [];
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
    prevEpochKickouts,
    slashedValidatorCount,
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

const DAY_SECONDS = 86_400;

export function protocolTvlWindowChange(points, days) {
  if (!Array.isArray(points) || !Number.isFinite(days) || days <= 0) return null;
  const valid = points.map((point) => ({
    date: numeric(point?.date), value: numeric(point?.totalLiquidityUsd),
  })).filter((point) => point.date !== null && point.date > 0 && point.value !== null && point.value >= 0)
    .sort((a, b) => a.date - b.date);
  if (valid.length < 2) return null;
  const latest = valid.at(-1), windowSeconds = days * DAY_SECONDS;
  const toleranceSeconds = days === 1 ? 12 * 3600 : 36 * 3600;
  const candidates = valid.slice(0, -1).map((point) => ({ ...point, elapsedSeconds: latest.date - point.date }))
    .filter((point) => point.elapsedSeconds > 0 && Math.abs(point.elapsedSeconds - windowSeconds) <= toleranceSeconds)
    .sort((a, b) => Math.abs(a.elapsedSeconds - windowSeconds) - Math.abs(b.elapsedSeconds - windowSeconds));
  const prior = candidates[0];
  if (!prior || prior.value <= 0) return null;
  return {
    days, elapsedHours: prior.elapsedSeconds / 3600,
    startAt: new Date(prior.date * 1000).toISOString(), endAt: new Date(latest.date * 1000).toISOString(),
    startValueUsd: prior.value, endValueUsd: latest.value,
    changePct: (latest.value - prior.value) / prior.value * 100,
  };
}

function stablecoinDepegFindings(stablecoins = [], stablecoinHistory = {}) {
  if (!Array.isArray(stablecoins)) return [];
  const pegged = stablecoins.filter((asset) => asset?.pegType === 'peggedUSD');
  const totalNearSupply = pegged.reduce((sum, asset) => sum + Math.max(0, numeric(asset.currentNearCirculationUsd) ?? 0), 0);
  return pegged.flatMap((asset) => {
    const price = numeric(asset.priceUsd), circulation = numeric(asset.currentNearCirculationUsd);
    if (price === null || price <= 0 || circulation === null || circulation <= 0) return [];
    const deviationPct = Math.abs(price - 1) * 100;
    const samples = (Array.isArray(stablecoinHistory[asset.id]) ? stablecoinHistory[asset.id] : [])
      .filter((sample) => Number.isFinite(Date.parse(sample?.checkedAt)) && numeric(sample.priceUsd) !== null
        && Date.now() - Date.parse(sample.checkedAt) <= 72 * 3600_000)
      .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    const lastTwo = samples.slice(-2);
    const twiceAtLeastThree = lastTwo.length === 2 && lastTwo.every((sample) => Math.abs(numeric(sample.priceUsd) - 1) * 100 >= 3);
    const twiceAtLeastOne = lastTwo.length === 2 && lastTwo.every((sample) => Math.abs(numeric(sample.priceUsd) - 1) * 100 >= 1);
    if (!(deviationPct >= 5 || (deviationPct >= 3 && twiceAtLeastThree) || (deviationPct >= 1 && twiceAtLeastOne))) return [];
    const assetSharePct = totalNearSupply > 0 ? circulation / totalNearSupply * 100 : null;
    const direction = price < 1 ? 'below' : 'above';
    const severity = deviationPct >= 5 ? 'Critical' : deviationPct >= 3 ? 'High' : 'Moderate';
    return [{
      id: `stablecoin-depeg-${asset.id}`, title: `NEAR stablecoin peg deviation — ${asset.symbol || asset.name}`,
      observed: true, active: true, tone: severity === 'Critical' ? 'critical' : severity === 'High' ? 'high' : 'caution',
      state: `${severity} peg deviation`, severity: `${severity} token-level risk — ${deviationPct.toFixed(1)}% ${direction} the $1 reference`,
      trend: `${asset.name} (${asset.symbol || 'asset'}) is quoted at $${price.toFixed(price < 0.1 ? 4 : 3)}; this is a provider market-price observation, not a redemption test.`,
      confidence: 'Moderate — DefiLlama price and NEAR-chain circulation snapshot; its stablecoin response has no provider price timestamp or quote-confidence field.',
      evidence: `Observed price $${price.toFixed(price < 0.1 ? 6 : 4)} (${deviationPct.toFixed(2)}% ${direction} $1); reported NEAR-chain circulation $${circulation.toLocaleString('en-US', { maximumFractionDigits: 0 })}${assetSharePct === null ? '' : `, ${assetSharePct.toFixed(3)}% of USD-pegged NEAR circulation in this feed`}. Peg type=${asset.pegType}; price source=${asset.priceSource || 'not supplied'}.`,
      impact: `Holders may face severe value loss or impaired exits. This asset's reported NEAR-chain circulation is ${assetSharePct === null ? 'not comparable to a verified total' : `${assetSharePct.toFixed(3)}% of the USD-pegged supply covered by this feed`}; the quote alone does not establish ecosystem-wide solvency or reserves.`,
      next: 'Cross-check the asset’s actual markets and redemption routes, validate the contract/issuer, and confirm whether the provider price is current before making a custody or solvency claim.',
      query: 'GET https://stablecoins.llama.fi/stablecoins?includePrices=true; filter peggedAssets by pegType=peggedUSD and chainCirculating.Near.current.peggedUSD; compare price to 1 USD.',
      sourceIds: ['defillama-near-stablecoins'],
    }];
  });
}

export function assessLiveRisks({ market, tvl7d, tvl30d, validators, block, rpcStatus, blockActivity, nearProtocolTvls = [], nearStablecoins = [], stablecoinHistory = {}, declineThreshold = DEFAULT_ALERT_DECLINE_PCT, staleBlockSeconds = DEFAULT_BLOCK_STALE_SECONDS }) {
  const threshold = Math.max(5, Math.min(50, Number(declineThreshold) || DEFAULT_ALERT_DECLINE_PCT));
  const tvlDecline = numeric(tvl30d?.changePct);
  const priceMove = numeric(market?.priceChange24h);
  const blockTxCount = numeric(blockActivity?.transactionCount);
  const blockTxHeight = numeric(blockActivity?.blockHeight);
  const blockTxShardCount = numeric(blockActivity?.shardCount) ?? numeric(blockActivity?.chunkCount) ?? 0;
  const blockTxChunkCount = numeric(blockActivity?.chunkCount) ?? 0;
  const blockTxReusedShardCount = numeric(blockActivity?.reusedShardCount) ?? 0;
  const blockTxScope = blockTxCount === null ? '' : `${Math.round(blockTxCount).toLocaleString()} transactions across ${blockTxShardCount} shards (${blockTxChunkCount} newly included chunks${blockTxReusedShardCount > 0 ? `; ${blockTxReusedShardCount} prior-height references counted as zero` : ''})`;
  const blockAge = numeric(block?.ageSeconds);
  const rpcAvailable = Boolean(block && blockAge !== null && rpcStatus?.chain_id === 'mainnet' && typeof rpcStatus.syncing === 'boolean');
  const marketPrice = numeric(market?.priceUsd);
  const marketAsOf = market?.timestamp ? ` as of ${market.timestamp}` : '';
  const marketEvidence = priceMove === null ? '' : `CoinGecko reported NEAR ${marketPrice === null ? '' : `at $${marketPrice.toFixed(4)} `}${priceMove > 0 ? '+' : ''}${priceMove.toFixed(2)}% over 24 hours${marketAsOf}.`;
  const risks = [
    {
      id: 'concentration', title: 'Validator stake concentration',
      observed: Boolean(validators), state: 'Current set observed',
      tone: 'neutral', severity: 'Context only — no historical risk threshold is configured',
      trend: 'One current-epoch validator set; prior epochs are not yet collected.',
      confidence: 'High for RPC-reported active-set stakes; does not represent all stakers or ecosystem apps',
      evidence: `${validators?.validatorCount ?? 0} current validators; top 10 hold ${validators?.top10SharePct?.toFixed(1) ?? '—'}% of stake in the reported set (HHI ${validators?.hhi?.toFixed(0) ?? '—'}).`,
      impact: 'Validator stake concentration is a governance and production-dependency indicator, not proof of collusion or a security failure.',
      next: 'Compare multiple epochs and add independently sourced application/contract concentration before broadening this risk.',
    },
    {
      id: 'activity', title: 'Finalized-block activity sample',
      observed: blockTxCount !== null, state: 'One finalized block observed', tone: 'neutral',
      severity: 'Context only — one block is not an adoption-risk score',
      trend: `One block sample: ${blockTxScope}; no daily or unique-user trend.`,
      confidence: 'High for the returned transaction arrays in this block; it does not measure users, retention or a trend',
      evidence: `${blockTxScope} in finalized block ${blockTxHeight?.toLocaleString() ?? '—'} (${blockActivity?.blockTimestamp ?? 'time unavailable'}). Transaction identities are not retained.`,
      impact: 'A block-local count describes activity in one sample; it does not identify users, returning behaviour or application diversity.',
      next: 'Compare successive complete samples before making a trend claim.',
    },
    {
      id: 'capital', title: 'Liquidity stock (TVL)',
      observed: tvlDecline !== null, state: tvlDecline === null ? '' : tvlDecline <= -threshold ? 'Drawdown watch' : 'Daily TVL observed',
      tone: tvlDecline !== null && tvlDecline <= -threshold ? 'high' : 'neutral',
      severity: tvlDecline === null ? '' : tvlDecline <= -threshold ? `Configured signal — ${threshold}% 30-day decline threshold crossed` : 'No configured 30-day TVL decline threshold crossed',
      trend: tvlDecline === null ? '' : `DefiLlama-reported NEAR DeFi TVL changed ${tvlDecline > 0 ? '+' : ''}${tvlDecline.toFixed(1)}% over ${tvl30d.days} days.`,
      confidence: 'Moderate for provider-reported USD TVL; low for net flows or capital retention',
      evidence: tvlDecline === null ? '' : `DefiLlama daily USD TVL changed ${tvlDecline > 0 ? '+' : ''}${tvlDecline.toFixed(1)}% over ${tvl30d.days} complete matched dates. TVL is an asset stock, not a net flow.`,
      impact: 'A sustained fall in TVL can indicate lower reported DeFi balances, but price changes and coverage changes may explain part of it.',
      next: 'Check underlying assets, protocol coverage and price-adjusted changes before calling a TVL move an ecosystem capital flow.',
    },
    {
      id: 'infrastructure', title: 'Infrastructure freshness',
      observed: rpcAvailable, state: !rpcAvailable ? '' : rpcStatus.syncing ? 'Node reports syncing' : blockAge > staleBlockSeconds ? 'Finalized block is stale' : 'Finalized block observed',
      tone: !rpcAvailable || rpcStatus?.syncing || blockAge > staleBlockSeconds ? 'caution' : 'positive',
      severity: !rpcAvailable ? '' : rpcStatus.syncing || blockAge > staleBlockSeconds ? 'Operational warning on this endpoint only' : 'No single-check warning observed',
      trend: 'A live point-in-time RPC view; local history only accumulates while this browser remains open.',
      confidence: 'High for the returned block/status; low for global network health or uptime',
      evidence: !rpcAvailable ? '' : `Finalized block ${Number(block.height).toLocaleString()} is ${blockAge.toFixed(1)} seconds old; queried node syncing=${Boolean(rpcStatus.syncing)}.`,
      impact: 'This can reveal an old block or syncing node view, but one provider cannot establish a network-wide outage or consensus fault.',
      next: 'Compare multiple independent RPC providers and keep a persistent observation history before making availability claims.',
    },
    {
      id: 'economics', title: '24-hour NEAR market change',
      observed: priceMove !== null, state: priceMove === null ? '' : priceMove <= -threshold ? 'Price decline watch' : 'Market snapshot observed',
      tone: priceMove !== null && priceMove <= -threshold ? 'high' : 'neutral',
      severity: priceMove === null ? '' : priceMove <= -threshold ? `Configured signal — ${threshold}% 24-hour market decline threshold crossed` : 'No configured 24-hour market decline threshold crossed',
      trend: priceMove === null ? '' : `CoinGecko aggregated NEAR market price changed ${priceMove > 0 ? '+' : ''}${priceMove.toFixed(2)}% over 24 hours${marketAsOf}.`,
      confidence: 'Moderate for aggregated market data; not protocol value capture',
      evidence: priceMove === null ? '' : `${marketEvidence}${block && block.estimatedGasFeeNear !== null ? ` Latest finalized-block gas cost was ${block.estimatedGasFeeNear.toFixed(6)} Ⓝ, shown as separate execution-cost context.` : ''}`,
      impact: 'Market repricing and per-block execution cost are separate observations; neither establishes sustainable token value capture.',
      next: 'Add a permitted historical fee series and protocol-level token-economic context before assessing long-run value capture.',
    },
  ];
  const kickouts = Array.isArray(validators?.prevEpochKickouts) ? validators.prevEpochKickouts : [];
  const slashedCount = numeric(validators?.slashedValidatorCount) ?? 0;
  if (kickouts.length || slashedCount > 0) {
    const sample = kickouts.slice(0, 5).map((item) => `${item.accountId} (${item.reason}${Number.isFinite(item.produced) && Number.isFinite(item.expected) ? `, ${item.produced}/${item.expected}` : ''})`).join('; ');
    const headline = slashedCount > 0 ? `${slashedCount} validator(s) marked slashed` : `${kickouts.length} previous-epoch kickout(s)`;
    risks.push({
      id: 'validator-performance', title: 'Validator performance / kickout evidence', observed: true, active: true,
      tone: slashedCount > 0 ? 'critical' : 'high', state: slashedCount > 0 ? 'Protocol-reported slashing' : 'Prior-epoch kickout observed',
      severity: slashedCount > 0 ? `Critical — RPC reports ${slashedCount} currently slashed validator(s)` : `High for affected operators — ${kickouts.length} validator kickout(s) reported for the previous epoch`,
      trend: `Live validator RPC response for epoch ${validators?.epochHeight ?? 'unavailable'}; kickouts are completed-epoch results, not a prediction.`,
      confidence: 'High for the returned protocol fields from this RPC snapshot; one provider does not establish a network-wide failure.',
      evidence: `${headline}${sample ? `; examples: ${sample}${kickouts.length > 5 ? `; plus ${kickouts.length - 5} more` : ''}` : ''}.`,
      impact: 'Affected validators may lose eligibility or rewards and shard participation can fall. A validator kickout is not evidence of slashing, malicious behavior, or a chain halt.',
      next: 'Inspect the reason and expected/produced counters, then compare the next finalized epoch and independent block/finality evidence.',
      query: 'POST https://free.rpc.fastnear.com with JSON-RPC method="validators", params=[null]; inspect result.prev_epoch_kickout and current_validators[].is_slashed.',
      sourceIds: ['near-rpc-validators'],
    });
  }
  for (const protocol of Array.isArray(nearProtocolTvls?.protocols) ? nearProtocolTvls.protocols : []) {
    const current = numeric(protocol.nearTvlUsd);
    if (current === null || current < 100_000) continue;
    const day = protocolTvlWindowChange(protocol.points, 1);
    const week = protocolTvlWindowChange(protocol.points, 7);
    const breached = (day && day.changePct <= -20) || (week && week.changePct <= -30);
    if (!breached) continue;
    const criticalDay = day && day.changePct <= -40;
    const criticalWeek = week && week.changePct <= -50;
    const critical = criticalDay || criticalWeek;
    const window = criticalDay ? day : criticalWeek ? week : day && day.changePct <= -20 ? day : week;
    const duration = window.elapsedHours >= 48 ? `${(window.elapsedHours / 24).toFixed(1)} days` : `${Math.round(window.elapsedHours)} hours`;
    risks.push({
      id: `protocol-tvl-${protocol.slug}`, title: `NEAR protocol liquidity drawdown — ${protocol.name}`,
      observed: true, active: true, tone: critical ? 'critical' : 'high', state: critical ? 'Critical TVL drawdown' : 'TVL drawdown threshold crossed',
      severity: `${critical ? 'Critical' : 'High'} reported USD-TVL decline — ${window.changePct.toFixed(1)}% over ${duration}`,
      trend: `${protocol.category || 'NEAR protocol'}; latest reported NEAR-chain TVL is $${current.toLocaleString('en-US', { maximumFractionDigits: 0 })}.`,
      confidence: 'Moderate — chain-specific DefiLlama history is timestamped, but USD TVL can fall from token-price moves, adapter coverage or balance changes.',
      evidence: `${protocol.name} NEAR-chain TVL changed from $${window.startValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} to $${window.endValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} across ${duration} (${window.startAt} to ${window.endAt}); this is a reported asset-stock decline, not proven net withdrawals.`,
      impact: 'Lower reported liquidity can constrain exits or indicate repricing. No claim of insolvency, exploit, fraud or cause is made from TVL alone.',
      next: `Check ${protocol.name}'s token composition, independent market prices and contract-level balances before attributing the move to withdrawals or an incident.`,
      query: `GET https://api.llama.fi/protocol/${encodeURIComponent(protocol.slug)}; use chainTvls.Near.tvl[].totalLiquidityUSD and compare dated observations (no interpolation).`,
      sourceIds: ['defillama-near-protocol-tvls'],
    });
  }
  risks.push(...stablecoinDepegFindings(nearStablecoins?.assets, stablecoinHistory));
  return risks.filter((risk) => risk.observed).map(({ observed, ...risk }) => risk);
}

export function formatSignedPercent(value, digits = 1) {
  const parsed = numeric(value);
  return parsed === null ? 'Unavailable' : `${parsed > 0 ? '+' : ''}${parsed.toFixed(digits)}%`;
}
