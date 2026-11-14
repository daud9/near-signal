# NEAR SIGNAL thesis: activity is rising faster than its observable value capture

## Claim

Recent NEAR mainnet usage indicators increased, but the available evidence does **not yet establish sustainable economic value capture or durable adoption**. NearBlocks’ indexed daily averages for 30 October–12 November 2026 show transactions up 20.1% and active account identifiers up 45.5% versus 16–29 October. Indexed daily transaction fees rose only 3.0%, while indexed transaction volume fell 13.9%. Transactions per active account declined 17.5%.

This is a short, descriptive comparison—not a forecast, valuation, or causal explanation. The dashboard’s narrower hypothesis, “Higher daily transaction counts coincide with more active accounts,” is supported by the two-window changes and a Pearson correlation of 0.88 across 28 daily observations. That correlation is trend-sensitive, non-causal, and not a user-retention test.

## Evidence that supports activity growth

The rebuild fetched 50 daily rows from each of the transaction and account endpoints. After matching on UTC dates and excluding the current day, 49 complete dates were available through **12 November 2026**. For the current 14-day window, average reported activity was 716,892 transactions, 159,709 active account identifiers, 82,324 active contracts, and 848.43 Ⓝ in indexed transaction fees per day. The comparison is calculated from [NearBlocks’ transaction statistics](https://api.nearblocks.io/v3/txn-stats?limit=50) and [account statistics](https://api.nearblocks.io/v3/address-stats?limit=50); their [API reference](https://api.nearblocks.io/api-docs) is the field/provenance source.

The apparent account step-up is concentrated late in the period. The last four matched days averaged 230,705 active accounts, compared with 131,311 for the preceding ten days in the same 14-day window. That break merits an event-level explanation and longer observation before treating it as durable adoption.

## Evidence that challenges the stronger growth story

Fee generation barely moved alongside the activity change: indexed fees were up 3.0% against transactions up 20.1%. The derived transactions-per-active-account proxy fell from 5.44 to 4.49. This is consistent with broader address-level activity, but it does not show that more people returned, that apps diversified, or that users paid more fees.

The recent signer diagnostic is also too narrow to support an ecosystem-wide concentration conclusion. In 100 newest indexed transactions, the top signer accounted for 42% of rows, 29 signer identifiers appeared, and sample HHI was about 2,016. This is a sample-only indicator, not proof that a network participant or application controls 42% of NEAR activity.

## What would change the view

The positive interpretation would strengthen if a longer, independently reproduced series showed sustained account and transaction growth alongside fees or other documented value capture; if account cohorts showed returning participation; if usage spread across applications/contracts; and if a verified asset-level Intents/bridge series showed net capital retention rather than gross transfers.

The thesis would weaken if the recent address/transaction step-up reversed, remained concentrated in a small set of contracts or signers, or failed to produce durable return behaviour and fee growth. The data would change this conclusion only after checking those signals against better coverage—not by assigning an optimistic composite score to missing dimensions.

## Boundaries

The values above come from a third-party indexer and its timestamps; the latest matched day in this fetch was two days behind the run date. Active accounts are addresses, not verified people. Fees are not protocol revenue or token returns. Indexed transaction volume is not net capital flow. The 28-day correlation does not establish causality or prediction. NEAR SIGNAL therefore withholds its overall NEHS until capital resilience, network-wide concentration/dependency, and historical infrastructure health can be measured with defensible sources.

Reproduce the snapshot and 14-day calculations with `npm run rebuild`; run the unit tests with `npm test`. The output currently records normalized daily observations and source URLs. It is not a substitute for an independent BigQuery validation, which remains planned.
