# Vouch — Chainlink CRE judging narrative (one page)

**Track:** Best Confidential Workflow ($2,000, up to 2 teams — verify amount on the live prizes page).
**Package:** `packages/cre-workflow` (`@vouch/cre-workflow`), `@chainlink/cre-sdk@1.20.1`.
**Official submission video:** [`demo-script-graph.md`](demo-script-graph.md). Deep-dive:
[`demo-script.md`](demo-script.md). Full runbook + trust model:
[`chainlink-confidential-workflow.md`](chainlink-confidential-workflow.md).

## The one-paragraph pitch
Vouch's payout gate is a **private regression verdict computed inside a Nitro TEE**. The confidential
test suite, the pass/fail threshold, and the repo credential are all released **only inside the enclave**;
just a minimal declassified verdict leaves it. That DON-signed 7-tuple verdict is the **sole gate** on
the on-chain guarantee payout — no Vouch backend and no agent can trigger it. This is why the product
novelty (proving a *covered failure after payment* with a *private* test) needs confidential compute.

## What to point at (cite these facts)
- **Real TEE handler.** `handlerInTee<…>` at `workflow.ts:213-224` with the Nitro TEE constraint
  `[{tee:"nitro", regions:["us-west-2"]}]`. The workflow **source and WASM are public** — so nothing
  sensitive is inlined; the private material is fetched/released at runtime inside the enclave.
- **Secret-in-enclave.** Repo/test-API credential injected via **Vault DON `{{.token}}`** templating on
  `ConfidentialHTTPClient` (`Authorization: Bearer {{.token}}`, never in node memory or logs). Private
  pass threshold read via `runtime.getSecret({id:"PASS_THRESHOLD"})`; private suite selected via
  `PRIVATE_TEST_REF`. The authenticated test-API response (`{passRate, failureCode, commitHash,
  coverage}`) is evaluated **only** inside the TEE.
- **The 7-tuple verdict is the sole payout gate.** Encode order: `chainId`, `hub`, `jobId`, `covered`,
  `amount`, `evidenceCommitment`, `evaluatedAt`. `onReport` validates each field and moves state
  `ClaimPending → ClaimPaid` on `covered=true` (capped `min(amount, guaranteeAmount)`, remainder to
  provider) or back to `InitiallyApproved` on `covered=false`. `amount ∈ {0, guaranteeAmount}` by
  construction (secret-independent, zero incremental leakage). Contract **reverts, never clamps**, on a
  zero/over-cap amount. `workflowId = keccak256("vouch-assurance-v1")`, `workflowName = "vouchclaim"`.
- **Simulate is explicitly accepted evidence.** Official rule: "either a Confidential Workflow
  simulation using the CRE CLI **or** a live deployment." CRE Confidential Workflows are **private
  beta** — no live enclave deploy is expected/required, and an on-chain state change is not strictly
  required for this prize (our payout is a bonus). Evidence:
  `docs/evidence/simulate-cli-payout.txt` (**REPORTED:PAYOUT**, cre CLI v1.33.0) + 5 deterministic
  harness fixtures + `docs/evidence/MANIFEST` (exact command, `cre --version`, SDK version, per-file
  sha256). `gate:secrets` passes; the secret stays a `{{.token}}` template throughout.
- **Runnable now:** `node --import tsx packages/cre-workflow/harness.ts fixtures/valid-failure.json`
  (PAYOUT), `…/valid-pass.json` (CLEAN_CLOSE), `…/timeout-error.json` (REFUSE) — no CRE account needed;
  drives the full decide+encode path and shows **no secret in output**.

## Honest trust model (state prominently — a documented strength, not a weakness)
- **Testnet settlement authority is a TRUSTED EOA RELAY.** Arc testnet has **no canonical
  KeystoneForwarder**, so there is **no on-chain DON-signature verification** yet. A malicious relay
  could mint a valid report for any `ClaimPending` job; the only real on-chain bounds are
  **client-recipient-binding** (payout goes to the job's client) and **`amount ≤ cap`**. Identity /
  domain / commit checks defend against accidents, outsiders, and cross-chain replay — not a compromised
  relay.
- **TEE protects confidentiality of inputs, not attested integrity of output.** The SDK exposes **no
  raw Nitro attestation document** — the submission does **not** claim one. The externally-verifiable
  proof is the DON-signature-gated `onReport` under the pinned workflow identity.
- **`simulate` ≠ attested; single local node.** Simulate/harness is a single local node, not proof of
  on-chain delivery and not a Nitro attestation. (In local sim, `handlerInTee` runs the WASM on your
  machine, so enclave logs surface on stdout — which is how we prove no secret leaks.)
- **The confidential test API is a trust root in both directions** (can cause or veto a payout), and a
  single operator controlling both the API and the relay reconstitutes agent-as-authority — bounded only
  by recipient-binding + cap. **Mainnet roadmap:** the attested-DON path (real KeystoneForwarder +
  on-chain DON-signature verification).

## Video timestamp map (against [`demo-script-graph.md`](demo-script-graph.md))
| Timestamp | Chainlink beat |
|---|---|
| **2:40** | `openClaim` → CRE Confidential Workflow runs the private test in `handlerInTee` (Nitro); log shows **no secret** |
| **3:00** | Harness `PAYOUT` verdict → 7-tuple → `onReport` → `GuaranteePaid` + `CollateralReleased`, capped payout to client |
| **3:15** | (thesis close) — the DON-signed verdict was the sole gate; covered claim jobId 1 = `0x9659db91…` |

> For the full simulate/live runbook, evidence checklist, and the complete 7-tuple validation table, see
> [`chainlink-confidential-workflow.md`](chainlink-confidential-workflow.md).
