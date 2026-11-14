# Metrics and evidence boundaries

## What “live” means

A live signal is a timestamped response from a public provider. It is not an archive, SLA or independent confirmation. Fetch time and provider observation time are shown separately. A failed or pending request remains unavailable, never zero. A failed refresh can retain its last good value; the app marks that value as retained and flags it stale after its source-specific age threshold. Browser-local block history grows only while the page is open.

## Value Capture Lab

The current RPC observation requests a finalized block and its chunks. It estimates block gas cost as `sum(chunk.gas_used) × block.header.gas_price ÷ 10^24` NEAR. Utilization is reported chunk gas used divided by reported chunk gas limits. These are live block observations, not a complete accounting of fees paid or protocol revenue.

NEAR documents separate gas purchase, burning and refunds; a transaction may create later refund receipts. `tokens_burnt` is an execution-outcome field and need not equal `gas_burnt × current gas price`. Contract rebate rules also depend on protocol version. A durable value-capture analysis must reconcile finalized transaction/receipt outcomes, block-specific gas prices, protocol-version parameters, refunds, issuance, epoch rewards and treasury flows. It must not equate gross gas deductions with tokenholder return. No historical fee ledger is connected.

## Network activity and adoption

The app samples FastNEAR Neardata at the exact finalized RPC block height. Each chunk newly included at that height must match the block's referenced shard ID, hash and inclusion height and contain valid transaction hashes; a missing, duplicated or mismatched new chunk withholds the sample. A shard reference whose inclusion height is earlier contributes zero transactions for this block and does not require the old chunk body.

For up to 60 recent browser-local observations, the evidence export retains finalized block references, current-height chunk verification fields, prior-height references and transaction hashes so the count can be replayed. Full transaction bodies and receipt payloads are discarded. This is not a daily transaction series, unique-user count or retention measure. A signer account is not a person; an account lookup does not establish adoption.

## Ecosystem Risk Radar

Risk cards keep severity (potential impact) separate from confidence (source quality, freshness and completeness). Threshold crossings based on stale provider observations remain visible as historical context but are not counted as active findings. The configurable 5–50% decline threshold applies only to the 24-hour CoinGecko price change and complete 30-day NEAR DeFi TVL change; it does not change the specialized rules below.

**Stablecoin peg rule.** Read DefiLlama `peggedAssets[]`; require `pegType=peggedUSD`, a positive price, and positive reported `chainCirculating.Near.current.peggedUSD`. The deviation is `abs(price − 1) × 100`. A single observation at ≥5% is critical token-level risk; ≥3% for two checks or ≥1% for two checks is a high or moderate finding, respectively. Local browser price observations are retained for 72 hours to enforce the two-check rule. The endpoint has no provider price timestamp or confidence field, so the card uses browser fetch time and calls its source confidence moderate. This tests quoted market price, not redemption, reserves, or solvency.

**Aggregate stablecoin-supply rule.** Read [DefiLlama's NEAR stablecoin chart](https://stablecoins.llama.fi/stablecoincharts/Near), preserve the raw response and the `totalCirculating.peggedUSD`, `totalCirculatingUSD.peggedUSD`, and `totalMintedUSD.peggedUSD` fields, and use `totalCirculating.peggedUSD` as the aggregate series. Exclude the current UTC date, require eight consecutive daily observations and compare the first/last values. A decline of at least 10% across seven days is a high investigation watch. Missing dates are not interpolated. Provider coverage changes, migrations, classifications and historical corrections can explain discontinuities; the alert is not a redemption, reserve, withdrawal or solvency measure.

**Protocol liquidity rule.** Query DefiLlama `/protocols`, exclude CEX rows, select up to eight rows with a reported `chainTvls.Near` of at least $100,000, then query each `/protocol/{slug}` and use only dated `chainTvls.Near.tvl[].totalLiquidityUSD`. No global, multi-chain `change_1d` is mislabelled as NEAR-only. With no interpolation, flag high when a valid near-one-day observation window falls ≥20% or the approximately seven-day window falls ≥30%; flag critical at ≥40% and ≥50%, respectively. The one-day sample must fall within 12 hours of 24 hours; the seven-day sample within 36 hours of seven days. The card shows actual source dates and USD values; a TVL fall may be market repricing, adapter coverage or balance change and is not proof of outflow, insolvency, or an exploit.

**Validator performance rule.** The finalized `validators` response is parsed for `prev_epoch_kickout[]` account/reason/expected/produced fields and `current_validators[].is_slashed`. A kickout creates a high-severity finding for affected validator operations, not a chain-wide outage or proof of malicious conduct. `is_slashed=true` is a separate critical protocol-reported observation. Current concentration remains descriptive; its live snapshot is not a historical trend.

**APR/APY boundary.** The public DefiLlama yield routes stopped working on 2026-11-13, and the connected feeds do not offer a universal NEAR rate/reward/fee schema. No unsupported APR/APY values or alerts are manufactured. A sustainable-yield assessment needs verified protocol contract IDs and view methods, rate/reward decomposition, timestamped observations, token decimals/prices, and enough history; advertised APY alone is not proof of fraud.

A triggered rule is a prompt for investigation, not proof of a security incident. One provider's status is not network-wide uptime. A failed, missing or stale input is never a low-risk result; unavailable administrator, bridge, multisig, oracle, solver reserve and cross-protocol historical data remain out of scope until the required public evidence can be connected.

## Market, TVL and capital-flow context

CoinGecko's market volume is gross exchange turnover. DefiLlama TVL is a daily USD-denominated asset stock; price movement and provider coverage can change it without deposits or withdrawals. The chart joins exact UTC dates, excludes the partial current date, and does not fill gaps.

The NEAR Intents Explorer is documented as read-only history for 1Click Swap records. It requires partner access and is not a complete index of all Intents activity. No token or data pull is configured. Explorer statuses alone do not establish final destination delivery. A future net-flow ledger must reconcile asset/chain direction, `intents.near` settlement, bridge/destination evidence, refunds and pending legs; no TVL or transaction-count proxy is labeled net flow.

## Thesis Challenge Engine

The selectable test aligns daily price, TVL or gross-market-volume observations by exact UTC date, computes daily percentage changes, and calculates Pearson's `r` on the selected number of consecutive matched dates. It also reports same-sign counts among non-zero pairs (zero changes are ties) and the range of `r` after omitting each selected date once. The headline verdict still uses full-window `r`; the ±0.30 cutoff is a product rule, not a validated statistical cutoff. No p-value, confidence interval, causal estimate, forecast or user-adoption inference is made. The leave-one-day-out values are influence diagnostics, not proof of robustness. The current controls cannot test the official Intents-volume-versus-on-chain-activity hypothesis because those datasets are unavailable.

## Rebuilding the charts

Every displayed chart includes its source request or calculation, matching/validation rule and a plain-language explanation. Browser observations retain the raw finalized block and minimal chunk verification fields plus transaction hashes; full transaction bodies and receipt payloads are discarded. `npm run replay` reconstructs charts from saved evidence without network access. `npm run rebuild` refreshes connected public inputs and regenerates the evidence bundle and replayed chart inputs. This rebuild covers connected inputs; it cannot reconstruct missing historical account, contract or Intents series or turn browser history into a chain archive.

## Composite health score

The overall score is withheld. Daily retention, complete capital flows, historical fees, application/dependency concentration and multi-provider infrastructure history are not measured well enough for a defensible composite. No unavailable dimension is assigned a placeholder value.

## Workspace tools

The account inspector requests `query` with `request_type: view_account`, `finality: final` and a validated NEAR account ID from the same public mainnet RPC. It shows returned balance (not a spendable quote), locked amount, storage, code-hash presence and finalized block height. Raw request/response and fetch time are exportable. It does not infer account history, people or organic adoption. Reads are user-initiated and at least five seconds apart.

The execution calculator multiplies a user-entered hypothetical Tgas budget by the latest observed block gas price. USD conversion uses the available timestamped market price. Missing live inputs stay unavailable; storage and other charges are excluded. It is not a transaction quote or revenue forecast.
