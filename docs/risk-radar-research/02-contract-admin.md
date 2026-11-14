# Smart-contract and admin-control risk (NEAR)

## Scope and interpretation

This note covers observable upgrade and key-control evidence for a **known NEAR contract account**. A signal describes control or changeability risk, not maliciousness. An alert must be emitted only when the test has an observed result at a stated finalized block and evidence is retained (request, response, block hash/height, and timestamp). “Not observed” is not an alert.

**Risk impact** and **source confidence** are separate. Impact describes what the condition could allow. Source confidence is high for finalized protocol RPC fields and lower when interpreting arbitrary contract bytes or self-reported metadata.

## What public NEAR RPC can reveal

The standard `query` RPC supports `view_account` with `amount`, `locked`, `storage_usage`, `code_hash`, and the returned `block_hash`/`block_height`. `view_code` returns the deployed WASM as base64. `view_state` returns raw contract key/value pairs as base64 and supports pagination; the default non-paginated state-size limit is 50,000 bytes, and each page is capped at 10,000 items / approximately 50,000 bytes. `changes` supports `data_changes` and `contract_code_changes`; code-change values are base64 WASM. These are protocol-level observations, not claims about intent. [1]

`view_access_key_list` returns every access key with nonce and permission, subject to pagination (nearcore 2.14+ rejects an unpaginated request above the node’s 100-key default). `FullAccess` permits transfers, key management, deployment, and arbitrary contract calls. `FunctionCall` keys expose `receiver_id`, optional `method_names`, and optional gas `allowance`; they cannot attach NEAR. A zero-key account is locked from externally signed transactions, but its own code may still transfer assets, add keys, or update code if it exposes an authorized method. [1] [2]

Public reads can therefore establish the current code hash, retrieve the current WASM, enumerate on-chain keys and their protocol permissions, inspect raw state, call a known read-only method, and compare finalized code/state at historical blocks when the endpoint is archival or retains the requested history. Exact historical samples from a recent-only feed do not by themselves prove a complete history.

## What public RPC cannot establish by itself

A code hash does not identify the source, maintainer, or whether the code is safe. Raw WASM and raw base64 state do not reliably reveal the semantic owner, multisig/DAO policy, upgrade quorum, timelock, emergency powers, or whether a method can indirectly deploy code. Those require source/ABI knowledge, contract-specific decoding, and often transaction/receipt analysis. A visible `FullAccess` key proves protocol capability, not who controls the private key. A locked account is not necessarily immutable: NEAR’s own upgrade guide states that an authorized self-upgrade method can still change code. [3]

NEP-330 is a **discretionary** contract-level metadata convention, not an authoritative registry. A contract may expose `contract_source_metadata()` with a source link, version, standards, and reproducible-build information, but absence is not proof of unsafe code and presence is self-reported until independently rebuilt and hash-compared. The official `near-verify-rs` implementation can reproduce a build from NEP-330 metadata and compare its checksum with deployed WASM; it is a verifier/tool, not a public registry of every NEAR dApp. [4] [5]

NearBlocks documents account, contract, deployment, and key endpoints, but its API documentation requires an API key for requests and describes a third-party indexed service. It is not a keyed-free authoritative registry and is not part of the currently connected feeds. [6]

## Candidate live signals and reproducible rules

### 1. Missing or changed deployed code

- **Endpoint/fields:** `POST {FASTNEAR_RPC}/` with `method: "query"`, params `{request_type:"view_account", finality:"final", account_id}`; use `result.code_hash`, `result.block_hash`, `result.block_height`. For historical deployment evidence, `method:"changes"`, params `{changes_type:"contract_code_changes", account_ids:[account_id], block_id:<height-or-hash>}`; retain each returned code-change base64 and compute its SHA-256/base58 only if the implementation’s hash encoding is verified.
- **Formula/window:** at each finalized sample, `code_present = (code_hash != "11111111111111111111111111111111")` (the canonical no-code hash shown in NEAR’s example). For a selected finalized interval `[B0,B1]`, count distinct observed `code_hash` values and deployment-change records.
- **Severity:** **High impact** if an account expected to be a deployed dApp returns the no-code hash, or if an observed code hash changes unexpectedly. This is an observed integrity/control event, not a maliciousness verdict. **Source confidence: high** for the RPC observation; intent confidence: none.
- **Availability:** Current FastNEAR account-view feed can run the presence check only if it exposes `code_hash`. The historical change check needs the standard RPC `changes` method and retained/archival history; it can be added through a free public NEAR-compatible RPC endpoint, subject to rate/history limits.
- **Test evidence:** finalized request/response, account ID, block height/hash, old/new code hashes, and for a deployment change the returned base64 WASM digest.

### 2. Externally deployable account (FullAccess key present)

- **Endpoint/fields:** `query` with `request_type:"view_access_key_list"`, `finality:"final"`, `account_id`, and pagination (`limit`, `after_key`); inspect each `result.keys[].access_key.permission` for the string `"FullAccess"`. Record `block_hash`/`block_height` and paginate until no `result.next_key`/`last_key` remains according to the provider’s response shape.
- **Formula/window:** `full_access_count = count(permission == "FullAccess")` at each finalized sample. For historical key-control changes, use `changes` with `changes_type:"access_key_changes"` if supported by the selected RPC, or an indexed transaction/receipt source; do not infer history from current keys.
- **Severity:** **High impact** when `full_access_count > 0`, because any holder can deploy code, add/remove keys, transfer funds, or call arbitrary contracts. This is a capability flag, not proof of compromise. **Source confidence: high** for the current key permission.
- **Availability:** Not guaranteed by the app’s listed “account view” input. Add via free public RPC `view_access_key_list`; pagination is mandatory for large key sets. No paid API is required for the current-state test.
- **Test evidence:** complete paginated key list, each public key, permission object, finalized block hash/height.

### 3. Function-call-only or zero-key control posture

- **Endpoint/fields:** Same `view_access_key_list`; classify permissions as `FullAccess`, `FunctionCall`, or other supported gas-key variants. For `FunctionCall`, retain `receiver_id`, `method_names`, and `allowance`.
- **Formula/window:** `full_access_count == 0`; additionally report `function_call_count` and whether every key’s `receiver_id` equals the contract account. `zero_key = (keys == [])`.
- **Severity:** **Medium impact** for any FullAccess-free account whose FunctionCall keys allow unrestricted methods (`method_names` omitted) or target a broad/unexpected receiver; **lower external-admin impact** when `zero_key == true`, but do not call it immutable because self-upgrade methods remain possible. **Source confidence: high** for key permissions; semantic interpretation of allowed methods is medium without source.
- **Availability:** Addable with free public RPC; current account view alone is insufficient unless it includes keys.
- **Test evidence:** paginated key records and the exact classification inputs. Do not alert merely because the account has no keys; alert only for a defined observed policy violation (for example, a policy requiring no FullAccess keys but finding one).

### 4. Code-change frequency / recent deployment event

- **Endpoint/fields:** `changes` `contract_code_changes` at finalized block IDs, preferably using an archival RPC for a complete interval. Each returned change includes the changed WASM base64 and block context.
- **Formula/window:** For a configured window such as the last 30 days or last N finalized blocks, `deployment_events = number of non-empty code-change records`; `distinct_code_hashes = count(distinct hash(WASM))`. Compare with an explicit app policy (for example, “no deployments after launch” or “at most one deployment per 7 days”).
- **Severity:** **Medium impact** for an observed deployment outside the declared policy; **High impact** only when combined with an observed FullAccess key or an independently verified unexpected hash. No universal NEAR threshold is defensible.
- **Availability:** Requires `changes` plus archival/history coverage; not runnable from block/status/validators alone. Free public RPC may provide it, but provider retention and rate limits must be verified.
- **Test evidence:** block range, every deployment record, old/new digest, and the policy that was violated.

### 5. NEP-330 reproducibility check (conditional)

- **Endpoint/fields:** `query` `call_function` with `account_id` and `method_name:"contract_source_metadata"` (base64 JSON args, typically empty), at a finalized block; decode the returned `result.result` bytes as JSON. Read `version`, `link`, `standards`, and `build_info` fields including `build_environment`, `source_code_snapshot`, `contract_path`, `build_command`, and `output_wasm_path`.
- **Formula/window:** Reproduce the declared build using the pinned environment/source revision/command and compare the resulting WASM hash to the deployed `view_code` bytes or its `view_account.code_hash`, using the NEP-330/near-verify-rs hash procedure. A match is a positive verification; mismatch is an observed integrity discrepancy. Metadata absence or a failed/unknown getter is **not** an alert.
- **Severity:** **High impact** for a reproducible source-to-WASM mismatch where metadata claims the source describes the deployed code; **low impact** for missing metadata. **Source confidence: high** for on-chain getter output, medium-to-high for the independent build depending on pinned inputs and build reproducibility.
- **Availability:** The getter and independent build are not among the currently listed feeds. The free RPC call can be added, but reproducible build execution is an additional local/CI capability, not a keyed-free registry.
- **Test evidence:** finalized call response, metadata, exact source revision, container digest, build command, resulting digest, deployed WASM digest, and reproducibility logs.

## Practical limits for the current feed set

FastNEAR block/status/validator reads and finalized block samples can anchor freshness and finality, and an account-view response can support the code-hash presence test if it includes `code_hash`. CoinGecko market/history and DefiLlama spot price/chain TVL provide market context only; their documented scopes do not expose NEAR account keys, deployed WASM, upgrade authority, or contract source verification. [7] [8]

The dependable keyed-free authoritative source for current control facts is the NEAR protocol RPC itself, not an external registry. A free public RPC can add access-key lists, code/state reads, read-only calls, and (where archival) change history. There is no verified public, keyed-free registry that maps every NEAR dApp to a trusted owner/admin policy or source identity. Therefore, do not manufacture a risk score from missing registry data, missing NEP-330 metadata, market volatility, TVL, or a non-observed condition.

## References

[1]: https://docs.near.org/api/rpc/contracts "NEAR RPC Accounts / Contracts"
[2]: https://docs.near.org/protocol/accounts-contracts/access-keys "NEAR Access Keys"
[3]: https://docs.near.org/smart-contracts/release/upgrade "NEAR Updating Contracts"
[4]: https://github.com/near/NEPs/blob/master/neps/nep-0330.md "NEP-330 Source Metadata"
[5]: https://github.com/near/near-verify-rs "near-verify-rs reproducible contract verification"
[6]: https://api.nearblocks.io/api-docs "NearBlocks API documentation"
[7]: https://defillama.com/docs/api "DefiLlama API documentation"
[8]: https://docs.coingecko.com/reference/introduction "CoinGecko API documentation"
[9]: https://docs.fastnear.com "FastNear RPC / API reference"
