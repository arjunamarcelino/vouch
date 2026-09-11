# @vouch/cre-workflow

Chainlink CRE **Confidential Workflow** — runs the private regression verdict inside a **TEE**
(`handlerInTee`) and delivers a **DON-signed 7-tuple report** to `AssuranceHub.onReport` on Circle
**Arc**, causing a real `ClaimPending → ClaimPaid` (or `ClaimPending → InitiallyApproved`)
transition. This is the **only** place private tests, criteria, and repository credentials exist.

## What runs inside the enclave
- **`handlerInTee`** (TeeRuntime, `nitro` / `us-west-2`) wraps the whole evaluation. The TS SDK
  (`@chainlink/cre-sdk@1.20.1`) **does** expose `handlerInTee` — the earlier "TS has no
  `handlerInTee`" note was stale.
- **`ConfidentialHTTPClient`** performs the authenticated private-test fetch with the credential
  injected inside the enclave via `{{.token}}` Vault DON templating — the credential never touches
  node memory, source, or logs.
- **`runtime.getSecret({ id: "PASS_THRESHOLD" })`** supplies the private pass/fail threshold.
- The verdict is reduced to the minimum result set and declassified only as the FROZEN **7-tuple**
  report:

  ```
  (uint256 chainId, address hub, uint256 jobId, bool covered,
   uint256 amount, bytes32 evidenceCommitment, uint64 evaluatedAt)
  ```

  encoded with viem `encodeAbiParameters` (224 bytes, not packed). The report is produced via
  `runtime.reportFromDon(prepareReportRequest(hexPayload))` (payload passed as **hex** —
  `prepareReportRequest` base64-encodes internally) and written with
  `EVMClient.writeReport(...)` (success = `TxStatus.SUCCESS`).

## Fail-closed by construction
- Any uncertainty (read/fetch/parse failure, `status != ClaimPending`, missing/empty/NaN threshold,
  non-finite/out-of-range `passRate`, commit mismatch) → **REFUSE**, and **no report is emitted**;
  the permissionless `resolveClaimTimeout` closes the claim onchain.
- `CLEAN_CLOSE` (`covered=false`) is reachable **only** from a fully-validated definitive pass.
- **`amount ∈ {0, guaranteeAmount}`** — secret-independent (`guaranteeAmount` on PAYOUT, else `0`),
  **never** derived from `passRate`.
- The evidence commitment is a salt-free integrity/reproducibility binding over public-safe fields
  only (no `reportId`, no secret).

## Module layout
The SDK-independent core is split out so tests never import the SDK:
- `encoding.ts` — the 7-tuple ABI params + `buildVerdictPayload` + `assertBytes32`.
- `commitment.ts` — evidence-commitment preimage + keccak.
- `decide.ts` — the untrusted-response zod schema + pure `decideVerdict` (the fail-closed truth table).
- `config.ts` — the non-secret `configSchema`.
- `port.ts` — the `EvalPort` seam + the pure `runEvaluation` orchestrator (what tests exercise).
- `workflow.ts` — the ONLY SDK-coupled file: the real `EvalPort` + `handlerInTee` registration.

## Non-responsibilities
- **Never** inlines private test logic/criteria/threshold/credentials in source.
- Never writes secrets to Postgres, public onchain metadata, the subgraph, or IPFS; commits
  `secrets.yaml.example` only (`secrets.yaml` and `.env` are git-ignored).
- Does not size guarantees or quote risk (that is `@vouch/agent`); does not hold funds.

## Local harness (deterministic, no SDK, no secrets)
```bash
node --import tsx harness.ts fixtures/valid-failure.json   # PAYOUT   → prints the 7-tuple payload
node --import tsx harness.ts fixtures/valid-pass.json      # CLEAN_CLOSE
node --import tsx harness.ts fixtures/invalid-commit.json  # REFUSE (no payload)
```
Fixed clock + sentinel secrets + seeded `getJob`; prints the decision and would-be payload
(hex + base64) with **no** secret in the output.

## Simulate (CRE CLI)
```bash
cp .env.example .env            # high-entropy SENTINEL values only
cp secrets.yaml.example secrets.yaml
cre workflow simulate vouch-outcome-assurance --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload ./fixtures/valid-failure.json
```
Confirm no secret appears in the output before using it as evidence.

## Checks
```bash
pnpm --filter @vouch/cre-workflow typecheck
pnpm --filter @vouch/cre-workflow test
pnpm --filter @vouch/cre-workflow lint
```
