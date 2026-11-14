# NEAR AI Investment Thesis track alignment

NEAR SIGNAL follows the evidence-first intent of the [official Investment Thesis prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/02-thesis.md): state a falsifiable claim, show evidence for and against it, expose how each chart is built, retain a reproducible rebuild path, and document limitations in [`THESIS.md`](../THESIS.md).

## What is implemented

The six routed workspaces are **Overview**, **Thesis Challenge Engine**, **Ecosystem Risk Radar**, **Value Capture Lab**, **Network Activity & Validators**, and **Liquidity & TVL Context**. Thesis and Risk are primary workspaces after Overview. Each rendered chart provides its connected source request or calculation, validation/date-matching rule, and a plain-language explanation. The thesis test export includes its matched inputs, source times, status and limits.

Ten no-key public feeds are connected: FastNEAR public mainnet RPC for finalized blocks, status and current validators; FastNEAR Neardata for an exact-height transaction sample; CoinGecko for market snapshots and daily history; and DefiLlama for spot price, daily ecosystem TVL, selected NEAR protocol histories and stablecoin price/circulation snapshots. `npm run rebuild` fetches those feeds into a dated evidence file, evaluates the implemented observed risk rules, and regenerates chart replay inputs. `npm run replay` rebuilds charts from a saved evidence file offline. Neither command needs a new service or credential.

## What is not claimed

The app does not have daily signer/account cohorts, historical transaction or contract-usage series, returning-account retention, complete historical fees/rewards, authenticated Intents history or reconciled bridge/Intents net flows. A single finalized-block count is a sample, not a daily activity trend. The status of an API host is not evidence of complete or authorized historical access.

Those missing values are not represented by placeholders or inferred from market volume, TVL, validator counts or one block. As a result, the dashboard implements a reproducible subset of the full thesis analysis; it does not claim a complete rebuild of every potential track metric. The overall health score is withheld until the missing dimensions can be measured defensibly.

## Data and privacy boundaries

The dashboard fetches connected feeds directly from the browser. There is no server-side data proxy, provider credential, wallet connection or transaction-signing path. The separate Python/PostgreSQL ingestion tooling is optional and unconfigured; it is not required by the deployed site. No external database has been created.

No hackathon submission, new profile or public post has been made. The existing public destination is the only deployed app.
