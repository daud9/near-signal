# Submission status — not submitted

NEAR SIGNAL is a read-only dashboard in the user's existing repository and Vercel project. The requested implementation update remains confined to that project. No separate account/profile, hackathon submission, social post, or other public submission material has been created.

The Investment Thesis track is reflected in [`THESIS.md`](../THESIS.md), the [track-alignment notes](track-alignment.md), and the dashboard's five named modules. Each chart exposes its source request/query, derivation and plain-language explanation. The daily signer/transaction/contract SQL template uses `block_date` filters.

The implementation is not fully data-complete for the official track: Google Cloud metadata access returned HTTP 401, no BigQuery job was run because query cost requires review, and no NEAR Intents JWT is configured. Daily account and contract metrics, Intents history, reconciled cross-chain net flows and long historical block samples remain unavailable. The one-command rebuild covers connected public feeds only. These limits are stated in [`THESIS.md`](../THESIS.md) and [`docs/track-alignment.md`](track-alignment.md).

The existing Vercel deployment is the only public destination used for this task; no new hosted destination or hackathon submission has been created. Any separate submission, public post, account/profile creation or paid query requires the user's later direction and appropriate access/approval.