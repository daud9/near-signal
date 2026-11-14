# NEAR SIGNAL — submission package (draft; not submitted)

## Project description (draft)

**NEAR SIGNAL** is an independent, read-only investment intelligence MVP for the NEAR ecosystem. It compares source-reported network activity with indexed fees and account breadth, flags structural risks, and tests a defined adoption hypothesis against reproducible calculations. It exposes source timestamps and caveats, withholds an overall NEAR Ecosystem Health Score when capital, concentration, and infrastructure evidence is incomplete, and never substitutes fabricated values for missing data. It is a research tool, not investment advice.

## Problem and solution

Investors and ecosystem participants can find many NEAR charts, but activity, fees, liquidity, and adoption quality are not the same measure. Metric definitions and freshness vary by provider. A single growth chart can hide weak value capture or missing evidence.

NEAR SIGNAL puts matched activity and fee comparisons, address-level adoption proxies, a risk radar, data provenance, and a transparent thesis test in one interface. Its core commitment is to show what cannot yet be measured: it withholds NEHS rather than pretending that one indexer snapshot can cover ecosystem health.

## Innovation and NEAR integration

The product integrates read-only NEAR mainnet data from NearBlocks’ indexed transaction/account endpoints and a public NEAR RPC status call. It reports a small, reproducible metric set and retains the source URL, fetch timestamp, latest matched date, units, definitions, and caveats. This is not a wallet or transaction product. The main value to NEAR is a more independent, inspectable way to compare activity with economic and resilience evidence, rather than presenting growth without qualifications.

The work is differentiated by its evidence policy, not by claiming unique raw metrics. Its one predefined hypothesis test is deterministic and its interpretation warns against causal inference. Risk cards show state, severity, historical trend (or its absence), and confidence separately. Capital flows, cohort retention, broad contract concentration, and historic infrastructure health remain clearly marked gaps.

## Demonstrable features

1. Live public feeds, joined on complete UTC dates, with freshness/status labels.
2. 7/14/21-day activity, account, contract, fee, and volume charts.
3. Value-capture comparison that keeps fees and gross indexed volume distinct.
4. Adoption frequency proxy and caveats about accounts versus people/retention.
5. Six-category risk radar with adjustable decline threshold, evidence, severity, historical trend, confidence, impact, and next investigation.
6. Deterministic correlation-based test of one predefined adoption hypothesis.
7. Withheld NEHS with evidence-coverage labels and provisional weights.
8. Source registry and downloadable JSON evidence bundle; `npm run rebuild` produces a dated calculation snapshot.

## Technical architecture

Static HTML/CSS plus JavaScript ES modules. `src/data.js` is the read-only fetch/provenance layer; `src/analytics.js` contains pure calculation functions; `src/app.js` renders sections, controls, and exports. No third-party runtime packages, server, persistent database, account service, wallet connect, or signing path. See [architecture](architecture.md) and [methodology](methodology.md).

## Local setup and reproducibility

```bash
npm test
npm run check
npm run rebuild
npm run dev
```

Open `http://localhost:8000`. The dashboard requests live browser feeds. The rebuild command saves `data/latest-evidence.json`. The most recent retained snapshot ended on 12 November 2026. API access, terms, and freshness must be rechecked before a public demo. No hosted demo is available; because this app is local-only, the official rules require reproducibility and a video.

## Demo video outline (about 60–75 seconds)

1. Show the landing claim and read-only/source-timestamp labels.
2. Refresh the page and point to the latest matched date and live status.
3. Switch the activity window and explain that a date gap would suppress the comparison.
4. Show transactions, active accounts, and fees side by side; call out the current 14-day changes without calling fees revenue.
5. Open Adoption and explain address-level proxies and the unavailable retention test.
6. Open Risk Radar, set a decline threshold, and show each risk’s evidence state and confidence.
7. Submit the built-in adoption hypothesis and show its calculated `r`, sample size, rules, and non-causal caveat.
8. Open Method & Data, show why NEHS is withheld, then export a JSON evidence bundle.
9. Close by stating the project’s public limitations: no net-flow dataset, user cohort, or infrastructure history is claimed.

A desktop overview, risk radar, and mobile screenshot are in [`screenshots/`](../screenshots/). An 18-second silent local walkthrough is recorded at [`screenshots/near-signal-demo.mp4`](../screenshots/near-signal-demo.mp4); it shows live data, the built-in hypothesis result, risk cards, and methodology. The longer outline above is a suggested narrated version, not the duration of this clip.

## Suggested X post (draft only; not posted)

> Built at NEAR HACKATHON: NEAR SIGNAL — a read-only, evidence-first NEAR investment intelligence MVP. It compares usage with indexed fees, tests an adoption hypothesis, and withholds its ecosystem-health score when key evidence is missing. Demo/screenshots attached. @NEARProtocol #NEARHackathon

The final post must attach a demo video or screenshots and link the public repo/demo when available. The official rule says a local-only demo must include reproducibility and a video; screenshots alone are not enough when judges cannot open the demo.

## Official requirements and outstanding fields

The official [NEAR Hackathon rules](https://nearhackathon.com/HACKATHON.md) give a submission deadline of **2026-11-14 23:59 UTC** (2026-11-15 00:59 WAT). Required form information includes a public repository URL, public X post URL, project name, team lead, email, team size, selected track(s), NEAR account address, and a 20–2,000-character description. The Investment Thesis guidance calls for an evidence-first thesis, reproducible README steps, a one-command chart rebuild, and `THESIS.md` with supporting and contrary evidence and conditions that would change the author’s mind. Mainnet transactions and a production deployment are not mandatory; read-only sourced analysis and a local demo are suitable, subject to the local-demo reproducibility/video requirement.

## Release checklist

- [x] Working read-only app with live indexed data and a visible source registry.
- [x] Root README, one-command rebuild, `THESIS.md`, source/metric documentation, competitor matrix, screenshots, unit tests, demo outline, and a silent local walkthrough video.
- [x] Nine deterministic tests pass; Chromium interaction and 390px mobile checks passed.
- [ ] Verify NearBlocks API key/access and public/non-personal plan terms; current unauthenticated request success is not sufficient authorization for a public project.
- [ ] Confirm repository name/owner and obtain explicit approval before making this changed project public.
- [ ] Confirm team lead, email, team size, track(s), and NEAR account address.
- [ ] Obtain explicit approval before publishing the exact X post or submitting.
- [ ] Create/publish the public repo and submit the post before the cutoff. Neither has been done. Current GitHub access cannot create a repository and browser sign-in remains incomplete.

**Current readiness:** locally runnable and tested; **not submission-ready** until the provider’s public-use terms are resolved, the required public repository and post are authorized and created, and the demo video/reproducibility package is complete. The missing GitHub connection, required human/team fields, and explicit publication approval remain blockers. No public deployment, repository, post, or submission was made.
