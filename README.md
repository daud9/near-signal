# Revenue Stress Lab

A read-only, evidence-led dashboard that stress-tests whether NEAR activity, active-account observations, and transaction fees hold up across matched daily windows. It separates observed chain/indexer data from user-selected simulations and does not claim that fees or transfer volume equal protocol revenue.

## Data and privacy

The page fetches public NearBlocks v3 endpoints directly in the visitor's browser: daily transaction statistics, daily active-account statistics, and a 25-transaction signer sample. It uses no wallet connection, signing key, private API key, or write operation. If an API feed is unavailable, the dashboard does not substitute fabricated data.

## Run locally

From this folder, run `python3 -m http.server 8000` and open `http://localhost:8000`.

## Deploy

`deno.json` configures the repository root as a static Deno Deploy site. The dashboard remains a single static `index.html`; no build step is required. Deno's current Deploy documentation says the service is scheduled to sunset in April 2027, so plan a migration before then if the site must remain online beyond that date.

## Sources

- [NearBlocks v3 API](https://api.nearblocks.io/)
- [NEAR RPC documentation](https://docs.near.org/api/rpc/introduction)
- [Deno Deploy getting started](https://docs.deno.com/deploy/getting_started/)
