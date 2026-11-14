# NEAR SIGNAL thesis: market and TVL have weakened; adoption trend remains unknown

## Claim

The current evidence supports caution, not a bullish growth conclusion. Over the complete daily series spanning **14 October to 13 November 2026**, NEAR’s daily market-price endpoint fell from about **$5.04 to $3.42 (−32.1%)**. DefiLlama’s reported NEAR DeFi TVL fell from about **$243.1 million to $159.2 million (−34.5%)**, while CoinGecko’s daily gross market-volume endpoint fell from about **$1.12 billion to $408.4 million (−63.6%)**. The 31 matched dates are observed market/TVL context—not a measure of net investment, protocol revenue or daily users.

The short and medium windows point the same way: from 30 October to 13 November, daily price was **−15.6%**, TVL **−14.4%**, and gross market volume **−57.3%**; over the seven-day span, price was **−6.5%** and TVL **−8.0%**. These are endpoint-to-endpoint changes in dated provider observations, not averages or forecasts.

## What the live chain evidence says

In the local evidence snapshot generated at **2026-11-14 06:54:44 UTC**, the finalized block was height **224,478,873**. The app verified all **10** referenced shard chunks and counted **1 transaction** in that one block. A browser check about a minute earlier observed **3 transactions across 10 chunks** in a different finalized block. That variation is expected for a per-block sample; neither count is a daily activity trend.

The RPC-reported current active validator set contained **343 validators**. The top ten held **35.9%** of stake in that returned set; its stake HHI was about **216**. The returned epoch counters showed about **99.97%** block production. This is one current-set/epoch snapshot, not the full distribution of delegated NEAR, a historical performance series, or a security guarantee.

At the snapshot timestamp, CoinGecko reported NEAR at **$3.36** and −**2.68%** over 24 hours. DefiLlama’s independent spot observation was **$3.3600**, with provider timestamps about nine seconds apart. The dashboard compares timestamped spot prices only when they are no more than five minutes apart; these live market points may move after the snapshot.

## How to read the selected test

Across **14** matched daily changes from 31 October to 13 November, the default test that “NEAR price and TVL daily changes move in the same direction” reported Pearson **r ≈ 0.98** under its visible rule for positive co-movement. In that same period, both price and TVL declined. “Supported” here means the daily changes tended to move in the same direction; it does **not** mean either value increased, nor does it establish cause, statistical significance, or a forecast.

## What is still unknown

No permitted daily transaction/account history is connected. One block count cannot show whether activity is rising, falling, concentrated, or driven by returning people. Addresses are not people, and this build does not measure retention. The dashboard has no reconciled bridge or Intents net-flow history, no full application/contract inventory, and no long-run RPC uptime series. TVL can also move with token prices and provider coverage; exchange volume is gross market activity.

## What would change the view

The assessment would improve if a longer, reproducible chain-activity series showed sustained usage across blocks and dates, an authorized account cohort series demonstrated returning participation, and independently supported fees or other value-capture indicators strengthened. A price-adjusted TVL view, a complete asset-level bridge/Intents flow series, multi-epoch validator history, and a documented dependency inventory would test the unresolved capital and resilience questions.

The view would weaken further if the price/TVL declines persisted or if broader transaction and validator histories showed concentrated, deteriorating participation. None of those conclusions can be derived from the current single-block sample.

## Reproduce and inspect

Run `npm run rebuild` to fetch a new local evidence snapshot and `npm test` to rerun the deterministic calculation tests. The snapshot includes source timestamps, raw daily market/TVL data, the finalized block response, matched-window calculations, the descriptive test and explicit limitations. It does not retain transaction identities. NEAR SIGNAL is an analytical prototype, not investment advice; its overall NEAR Ecosystem Health Score remains withheld because important evidence dimensions are missing.
