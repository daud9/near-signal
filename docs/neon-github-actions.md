# Neon Free + GitHub Actions: prepared, not connected

NEAR SIGNAL now has a manual GitHub Actions workflow for one-block ingestion into PostgreSQL, plus a fail-closed database-size stop. It is only a repository template: no Neon account, project, database, GitHub secret, or workflow run was created or authorized. The static dashboard remains separate and receives no database URL.

## Free-tier limits and the safety boundary

Neon's current [plan documentation](https://neon.tech/docs/introduction/plans) lists Free allowances of **100 compute-unit hours per project per month**, **1 GB of PostgreSQL storage per project** (with a 20 GB total across an account's Free projects), and **5 GB of public network transfer per project per month**. Free computes automatically suspend after five minutes of inactivity. When monthly compute or network-transfer usage is exhausted, Neon suspends compute until the next billing period; when storage reaches the project cap, additional writes fail. Neon does not automatically bill an overage on Free, but the database can become unavailable until the allowance resets or the owner changes plans. This workflow does not change a plan or call a billing/control-plane API.

The application stops writing at **800 MiB (838,860,800 bytes)** for the connected PostgreSQL database, before applying the schema or ingesting and again before commit. The stop can be lowered with `NEAR_SIGNAL_MAX_DATABASE_BYTES`, but the code rejects any value above 800 MiB. If it cannot read the database size, it refuses persistence. This is a conservative guard for the connected database, not a meter for all Neon branches/databases or the account-wide Free storage total; Neon remains the final enforcer of its project/account limits.

Compute and network quotas are not read through a Neon API and no broad Neon API token is needed. Instead, the workflow is manual-only, has no cron schedule, permits only one latest-block request or one explicit-height request per run, disables the alternate provider fallback, serializes concurrent runs, and times out after five minutes. The Neardata adapter also caps one response at 32 MiB. Neon itself suspends compute if its monthly Free compute or transfer limit is reached; there is no automatic paid upgrade path in this repository.

## Workflow behavior

The workflow is [`.github/workflows/near-ingestion.yml`](../.github/workflows/near-ingestion.yml). It needs a GitHub Actions repository secret named `NEAR_SIGNAL_DATABASE_URL` containing the authorized PostgreSQL connection string. The workflow never prints that variable. If it is absent, the CLI fails before making a provider request. Repository permissions are read-only (`contents: read`); the workflow creates no database, and schema initialization is unchecked by default.

For a first run after the user has independently prepared a Neon Free PostgreSQL project and added the secret, manually run **Actions → NEAR SIGNAL bounded ingestion → Run workflow** and check **initialize_schema** once. Then leave it unchecked. Pick `latest` for the live finalized tip, or `height` to fetch exactly one requested height. It does not backfill or create daily totals. The default run does not enable `--derive-observed-metrics`; any metrics produced elsewhere remain observed samples, not complete historical totals.

## What is still needed later

1. The user chooses and creates (or authorizes) a Neon Free project/database, staying on Free and ensuring any other Free projects fit the account-wide allowance.
2. The user adds that database's connection string as the repository Actions secret `NEAR_SIGNAL_DATABASE_URL`; it must not be committed to the repository, included in logs, or placed in the browser app.
3. The user pushes/merges the workflow and code into the repository's default branch, then initiates the first manual schema setup and one-block run.

Until those steps occur, the existing database remains unconfigured and no live database records are claimed. The setup does not add new signals or manufacture absent history. For full plan details, see [Neon Free plan limits](https://neon.tech/docs/introduction/plans) and [scale-to-zero behavior](https://neon.tech/docs/guides/scale-to-zero-guide).
