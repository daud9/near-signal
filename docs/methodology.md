# Metrics and risk methodology

## Matched windows

Daily transaction and account observations are joined by their exact UTC `date`. The current UTC day is dropped. A comparison uses the mean of the selected 7, 14, or 21 complete consecutive days and the immediately preceding window of the same length. A missing date or missing essential transaction/account count makes the comparison unavailable. It is never filled with zero or carried forward.

For a metric-specific mean, every day in that window must have a valid value for that metric. Percentage change is `(current-window mean − prior-window mean) / abs(prior-window mean) × 100`; it is not a day-over-day change. The dashboard exposes source as-of dates beside its fetch time.

## Displayed indicators

| Indicator | Calculation | What it does not mean |
|---|---|---|
| Transactions/day | NearBlocks transaction count, averaged over a matched period. | Unique users, economic value, or token returns. |
| Active accounts/day | NearBlocks active account identifiers, averaged by UTC day. | Verified people, retained users, or bot-free adoption. |
| Active contracts/day | NearBlocks daily active-contract count. | Unique applications, app diversity, or independent economic demand. |
| Indexed fees/day | NearBlocks `txn_fee` daily sum, averaged over days. | Protocol revenue, validator profit, token burn effect, or token value. |
| Indexed transaction volume/day | NearBlocks `txn_volume` daily sum. | Net inflow, liquidity retained, or new investment. |
| Transactions per active account | Window-average transactions ÷ window-average active accounts. | Cohort retention; it is a descriptive frequency proxy. |
| Recent signer sample HHI | For returned rows, `10,000 × Σ(signer row share²)`. | Chain-wide, historical, or contract-level concentration. |
| Daily activity correlation | Pearson `r` between daily transactions and active accounts over the prior + current window. | Causation, prediction, independent observations, or a formal significance claim. |

## Thesis verdict rule

The tested question is only: **“Higher daily transaction counts coincide with more active accounts.”** It is **Supported by available evidence** when both 14-day means increase and the Pearson correlation is at least 0.30. It is **Not supported** when the window changes oppose each other or correlation is negative. Other complete cases are **Partially supported**; incomplete windows or an undefined correlation return **Insufficient evidence**. The threshold is a transparent product rule, not a validated predictive model. No p-value or causal claim is calculated.

## Risk radar

Risk category, displayed state, severity, historical trend, evidence, and confidence are separate. When historical evidence is absent, the trend field says so explicitly; missing history is not rendered as a flat line. The configurable default decline alert is 20%; the control ranges from 5% to 50%. An adoption alert is raised when matched active-account change is at or below the selected negative threshold. An economic fee alert uses the same directional threshold on indexed fees. These are prompts for investigation, not proof of failure, manipulation, or network danger.

| Category | Evidence and trend | Current confidence / scope |
|---|---|---|
| Ecosystem concentration | HHI and top-share in the newest 100 returned signer rows, only when available. | Low confidence; sample is not representative enough for a network-wide risk verdict. Contract/app concentration history is absent. |
| Adoption sustainability | Matched active-account change and transaction frequency proxy. | Moderate confidence for indexed counts; low for human adoption, retention, and app usage. |
| Capital/liquidity | No capital risk score. | Insufficient evidence: no deduplicated asset-level net inflow/outflow series. |
| Infrastructure | One live mainnet RPC `status` result, if available. | Low confidence: no repeated uptime, performance, validator, or finality history. A single response is not a security assessment. |
| Economic sustainability | Matched indexed fee change, visibly not protocol revenue. | Moderate confidence in the indexer’s reported direction; low confidence in broader value-capture interpretation. |
| Ecosystem dependencies | Evidence gap and investigation prompt. | Insufficient evidence: no verified dependency inventory or incident feed. |

## NEHS: score withheld

The proposed health-score dimensions are economic sustainability, organic adoption, capital resilience, concentration/dependency, and infrastructure health. Equal 20% weights are provisional design choices, not validated parameters. Any future normalization must document indicator direction, clipping bounds, units, source, and missing-data treatment. The app currently shows evidence coverage and component states but deliberately does **not** calculate an overall 0–100 score. A single RPC snapshot or sample concentration metric does not count as full dimension coverage.

## Confidence and data quality

A numeric calculation can be reproducible while its interpretation remains low-confidence. Confidence labels therefore qualify source scope as well as formula. “Unknown” and “unavailable” differ from zero. An indexer request failure does not imply zero network activity. A current endpoint response does not imply full historical completeness. See the [source inventory](data-sources.md) for endpoint, freshness, and access caveats.
