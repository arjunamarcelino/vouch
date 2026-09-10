# @vouch/cre-workflow

Chainlink CRE Confidential Workflow — runs the private regression test inside a TEE. This is the
**only** place private tests, criteria, and repository credentials exist.

## Responsibilities
- Run the confidential regression evaluation inside the enclave when a coverage window closes.
- Fetch/inject private material at runtime via **Vault DON secrets** (`{{.token}}` templating) —
  private tests, private pass/fail thresholds, repo credentials.
- Reduce the result to the minimal verdict `{jobId, covered, amount}` — abi-encoded as
  `(uint256 jobId, bool covered, uint256 amount)` — and declassify only that for a DON-signed report
  delivered to `AssuranceHub.onReport`.
- Document and support `cre workflow simulate` as prize evidence.

## Non-responsibilities
- **Never** inlines private test logic/criteria in source (source/binary are not confidential —
  fetch at runtime only).
- Never writes secrets to Postgres, public onchain metadata, the subgraph, or IPFS; commits
  `secrets.yaml.example` only (`secrets.yaml` is git-ignored).
- Does not size guarantees or quote risk (that is `@vouch/agent`).
- Does not itself hold funds; it produces the signed verdict that authorizes payout onchain.

## CRE TypeScript note
The TS SDK has **no** `handlerInTee` / `TeeRuntime` / `usingTheDons`. In TypeScript,
confidentiality is delivered by **`ConfidentialHTTPClient`** inside a normal `handler`. Only the
**Go** SDK exposes `cre.HandlerInTee`. Do not ship a TS `handlerInTee` call — it will not compile.
Confirm the requirement wording and inspect the installed `@chainlink/cre-sdk` `.d.ts` first.

## Simulate
```bash
cre workflow simulate <name> --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload ./fixture.json
```
Local simulation reads secrets from `.env`. Confirm no secret appears in the output before using
it as evidence.
