# Implementation status

Updated 2026-11-14 during local MVP preparation. This is a project-state note, not a claim of external deployment.

## Implemented and locally verified

The app is a responsive static web page with a shared data layer and pure analytics functions. It fetches three NearBlocks public read endpoints and one NEAR mainnet RPC status response. It joins daily transaction/account rows by UTC date, excludes the current date, tracks feed errors, exposes as-of/fetch timestamps, and computes complete contiguous 7/14/21-day comparisons without synthetic fallback.

Working sections: Overview; Value Capture; Adoption; six-category Risk Radar with separate severity, historical-trend/data-gap, confidence, evidence, impact, and investigation fields; a deterministic test of one predefined activity/account hypothesis; a methodology/source registry; and JSON evidence export. The overall score is withheld. The `npm run rebuild` script creates a dated snapshot with raw NearBlocks feed arrays and normalized calculations.

The local live fetch returned 49 matched daily dates through 2026-11-12. Chromium verified data load and interactions for window selection, metric toggling, the risk threshold, and thesis test; all six risk cards show severity, trend, and confidence; mobile 390px width has no horizontal overflow. Nine calculation tests pass; syntax check passes. Desktop/mobile screenshots and an 18-second silent local walkthrough are in `screenshots/`.

## Partial / not fully verified

NearBlocks API access succeeded without an API key in the local test, but the official docs describe Bearer auth and the published free plan is for personal use with attribution/quotas. Public-project permission and long-term browser access are not verified. The app credits NearBlocks, but no paid API plan or server-side key proxy is configured.

The latest RPC call only confirms one endpoint response. It is not an uptime, network performance, validator, or security assessment. The 100-row signer sample is not a concentration estimate. The displayed Pearson correlation is a descriptive association and may be driven by trend/outliers.

## Planned / absent

No NEAR BigQuery SQL job or independently cross-checked query; no NEAR Intents/bridge flow integration; no account return/cohort retention; no full contract/app concentration; no validator/history monitor; no critical-dependency inventory; no numeric NEHS; no model-generated summaries; no hosted demo; no public repository or X post. NEAR Lake is documented as retired for new data and is not used as a live source.

## External status

The local worktree is retained at `/workspace/near-signal`. No public repository was created, no public post was made, and no application was deployed. The current connected GitHub path cannot create a repository. Explicit approval is required before any public release or submission, and is still pending.
