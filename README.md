# NEAR SIGNAL

**Measure the growth. Challenge the thesis.**

NEAR SIGNAL is a read-only, evidence-first NEAR ecosystem intelligence MVP. It compares observable network activity with indexed fees, shows where adoption and risk evidence is incomplete, and tests a narrow hypothesis using reproducible calculations. It does not connect a wallet, submit transactions, or issue investment advice.

## What works now

The responsive single-page app fetches live NearBlocks daily transaction and account statistics, a recent transaction sample, and the public NEAR mainnet RPC status. It joins historical statistics on UTC date, excludes the current day, shows 7/14/21-day comparisons, and draws charts from returned observations only. It includes a Value Capture view, address-level adoption indicators, six risk categories with a configurable decline threshold, separate severity/trend/confidence fields, a deterministic transaction/account hypothesis test, source links/statuses, and a JSON evidence export. Missing or incomplete data is not replaced by demo values.

The overall NEAR Ecosystem Health Score (NEHS) is **withheld**. Net capital flows, network-wide concentration, long-run infrastructure history, and dependency mapping are not measured. See [`THESIS.md`](THESIS.md), [methodology](docs/methodology.md), and the [source inventory](docs/data-sources.md) for what is verified, what is partial, and what remains planned.

## Run locally

Requirements: Node.js 18+ for tests and rebuild; Python 3 for the static web server. There are no third-party npm dependencies.

```bash
npm test
npm run check
npm run dev
```

Open `http://localhost:8000`. The browser must have network access to the listed public sources. `npm run dev` serves the local static files; it does not publish the project.

Run `npm run rebuild` to fetch the public NearBlocks feeds and write `data/latest-evidence.json`, a timestamped snapshot containing the raw returned feed arrays, normalized observations, derived 14-day metrics, and caveats. It exits without writing a new snapshot if a required source fails. The interactive dashboard itself recalculates from its live browser fetch when opened or refreshed. Treat the checked-in snapshot as dated evidence, not current data.

## Reproducibility and tests

- `npm test` runs deterministic unit tests for joins, UTC-day exclusion, missing fields, complete-window requirements, threshold alerts, sample HHI, Pearson correlation, and hypothesis verdicts. The synthetic numbers in tests are fixtures only; no test fixture is used by the dashboard.
- `npm run check` parses the application and ingestion script.
- `npm run rebuild` performs the real-source ingestion and 14-day metric rebuild in one command.

## Data, privacy, and release caveats

The browser app currently makes four read-only requests per refresh: three GET calls to NearBlocks and one NEAR RPC `status` request. No private key, wallet, or user record is sent. NearBlocks’ official API documentation describes Bearer-key authentication, attribution, and usage limits. Its published free plan is for personal use; public hackathon use may need a different plan or provider approval. Unauthenticated requests succeeded during the local test, but this does not establish continuing access or permission for public/commercial use. Confirm the provider terms before public deployment. If a key is required, place it behind a server-side proxy—never embed it in `index.html` or browser JavaScript.

The visible source registry credits and links NearBlocks and official documentation. If a public demo uses NearBlocks data, keep that attribution. All feeds can change, lag, fail, or be limited; the UI shows the most recent matched UTC date and request status. The snapshot generated on 2026-11-14 contained 49 matched dates through 2026-11-12; that is a historical fetch, not a freshness guarantee.

## Project status

**Implemented and verified locally:** live read-only feeds; joined daily history; 7/14/21-day comparisons; charts; value-capture and adoption indicators; sample-only signer HHI; six risk categories with severity, explicit historical trend/data-gap status, and confidence labels; configurable decline threshold; deterministic thesis test; methodology/source registry; JSON export; one-command data rebuild; responsive mobile layout; nine calculation tests.

**Incomplete or planned:** official NEAR BigQuery integration and SQL query artefacts; deduplicated Intents/bridge net-flow history; cohort retention and return-account analysis; full contract/application concentration; repeated RPC/validator history; dependency inventory; validated NEHS weights and numeric score; source-side key/terms confirmation; hosted demo; public GitHub repository and submission post. No deployment or public submission has been made.

## Screenshots and submission materials

- [Desktop overview](screenshots/near-signal-overview.png)
- [Risk radar](screenshots/near-signal-risk-radar.png)
- [Mobile overview](screenshots/near-signal-mobile.png)
- [Recorded local demo (18-second silent walkthrough)](screenshots/near-signal-demo.mp4)
- [Submission package and demo script](docs/submission-package.md)
- [Competitor analysis](docs/competitor-analysis.md)
- [Data-source inventory](docs/data-sources.md)
- [Architecture](docs/architecture.md)

## License and publication

No license has been selected. Do not treat this local working copy as a public repository or public demo. Publishing this changed project or submitting it requires explicit approval and provider-term review.
