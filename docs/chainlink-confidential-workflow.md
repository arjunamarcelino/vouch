# Chainlink CRE Confidential Workflow — Vouch confidential settlement

How `packages/cre-workflow` (`@vouch/cre-workflow`) satisfies Chainlink's **"Best Confidential
Workflow"** requirement: it runs the **private regression verdict inside a TEE** (`handlerInTee`,
Nitro / `us-west-2`), fetches the private test suite over an authenticated `ConfidentialHTTPClient`
with the credential injected **inside the enclave**, reads the private pass threshold via
`getSecret`, and delivers a **DON-signed report** to `AssuranceHub.onReport` on Circle **Arc** —
causing a real onchain `ClaimPending → ClaimPaid` transition that neither the Vouch API backend
(`apps/api`) nor the agent can trigger.

> **Honesty rule:** no module fakes a transaction or hard-codes a chain result; no secret appears in
> source, committed config, logs, or evidence. Confidentiality claims are scoped to what the SDK
> actually protects — the workflow protects the **secrecy of the criteria/threshold/credential** and
> the **computational integrity on a given input**, and binds settlement *authorization* to the DON
> signature. It does **not** make the payout *outcome* trust-minimized (see
> [Trust assumptions](#5-trust-assumptions--the-honest-model)). The live-onchain write is gated
> behind the [blocking pre-reqs](#8-blocking-pre-reqs) — never a fabricated tx hash.

---

## 1. What is confidential

Only **runtime enclave data** is protected. The workflow **source and compiled WASM are public** —
so nothing sensitive is ever inlined; the private material is fetched at runtime and released into
the enclave. What is confidential:

| Confidential item | How it stays secret |
|---|---|
| **Private regression tests / criteria** | Fetched at runtime from the authenticated test API; never in source or the WASM. |
| **Private pass/fail threshold** | Vault secret, read via `runtime.getSecret({id:"PASS_THRESHOLD"})` inside the TEE. |
| **Repository / test-API credential** | Injected inside the enclave via `{{.token}}` templating on `ConfidentialHTTPClient` — never in node memory or logs. |
| **The authenticated test-API response** | `{passRate, failureCode, commitHash, coverage}` is fetched and evaluated **only** inside the TEE (`handlerInTee`). The `passRate` is the raw signal the criteria are computed against. |

> The `ConfidentialHTTPClient`-in-a-normal-`handler` **fallback** (used only when TEE enrollment is
> unavailable, see §6) protects the **credential only, not the response data** — evidence produced
> that way is labeled as fallback, never presented as full-enclave evidence.

## 2. Why confidentiality is necessary

The private **regression criteria are the sole payout gate**. If the criteria, the threshold, or the
test suite leaked — to a node operator, to Postgres, to onchain metadata, or to the subgraph — a
provider could pre-test against the exact private suite, ship work that passes it while still being
defective, and defeat the guarantee. The whole product novelty (proving a *covered failure after
payment* with a *private* test) collapses the moment the private material is visible.

Because the source/WASM are public, confidentiality cannot come from hiding the program — it comes
from the enclave protecting the **runtime data** (fetched suite, threshold, credential, and the
test-API response) from the operators running it, verified by DON consensus before secrets are
released and the report is signed.

## 3. What enters / leaves the TEE

**ENTERS the TEE** (never in source; released/fetched at runtime):

| Enters | Mechanism |
|---|---|
| Repo / test-API credential | `{{.token}}` templated into the `Authorization: Bearer {{.token}}` header by `ConfidentialHTTPClient`; provisioned via `vaultDonSecrets`. |
| Private pass threshold | `runtime.getSecret({id:"PASS_THRESHOLD"})` (available on `TeeRuntime` via `SecretsProvider`). |
| Private-suite reference | `PRIVATE_TEST_REF` secret, injected into the request to select which suite runs. |
| Authenticated test-API response | `{passRate, failureCode, commitHash, coverage}` from the confidential `GET`. |

**LEAVES the TEE** — the **minimum result set** (the required-output list), declassified deliberately:

| Leaves | Where it lives |
|---|---|
| `jobId` | Onchain 7-tuple |
| `covered` | Onchain 7-tuple |
| `amount` (`∈ {0, guaranteeAmount}`) | Onchain 7-tuple |
| `evidenceCommitment` | Onchain 7-tuple |
| `evaluatedAt` | Onchain 7-tuple |
| **covered-failure-code** (coarse bounded enum) | Bound in the evidence-commitment **preimage** + revealed in the off-chain **opening JSON** (public-safe) |
| **evaluated commit hash** | Bound in the evidence-commitment **preimage** + off-chain opening JSON |
| workflow / report identifier | Keystone metadata (public) |

Only `jobId / covered / amount / evidenceCommitment / evaluatedAt` ride the onchain 7-tuple. The two
remaining required outputs — **covered-failure-code** and **evaluated-commit** — are **not** widened
into the tuple; they are bound into the evidence-commitment preimage and revealed in the off-chain
opening JSON (both public-safe).

**Leakage discipline:**
- `amount = guaranteeAmount` on `covered==true`, else `0` — a deterministic function of the
  already-public `covered`, so it adds **zero** incremental leakage of `passRate`. Proportional
  payouts are forbidden; asserted `amount ∈ {0, guaranteeAmount}` in tests.
- `failureCode` surfaces only as a **bounded coarse enum** (never a free string), non-invertible over
  repeated claims.
- No `runtime.log` ever prints a secret-derived value — in local simulation `handlerInTee` runs the
  WASM on your machine, so enclave logs surface on stdout.
- **Existence/timing side-channel (accepted):** a definitive clean pass (`CLEAN_CLOSE`) emits
  immediately; an inconclusive `REFUSE` emits nothing until the 3-day timeout — a chain observer can
  distinguish "definitive clean" from "inconclusive". A coarse leak; noted and accepted.

## 4. How the workflow changes onchain state

1. A client calls `openClaim` (in coverage) → `AssuranceHub` sets `status = ClaimPending` and emits
   **`ClaimOpened`** with `jobId` indexed (`topics[1]`).
2. The workflow's **EVM `ClaimOpened` log trigger** fires; the handler decodes `jobId` from
   `topics[1]`, then re-grounds a possibly-spoofed log with a `callContract(getJob(jobId))` read —
   `REFUSE` unless `status == ClaimPending`. That read also supplies `guaranteeAmount`,
   `submissionCommitment`, and `claimResolutionDeadline` (`ClaimOpened` does not carry the amount).
3. **`handlerInTee`** (`evalInTee`) reads the threshold (`getSecret`), fetches the private suite
   (`ConfidentialHTTPClient`), parses it with a strict zod schema, and runs the pure `decideVerdict`
   (fail-closed).
4. On a decisive verdict, it builds the 7-tuple hex payload and calls
   **`runtime.reportFromDon(prepareReportRequest(payload)).result()`** — a DON-signed report.
   (`prepareReportRequest` base64-encodes the hex payload internally; the payload is passed as **hex**,
   not pre-encoded.)
5. **`writeReport`** carries the signed bytes to Arc via the relay/forwarder, which calls
   **`onReport(metadata, report)`** on `AssuranceHub`.
6. `onReport` decodes the 7-tuple, validates it, and moves state: `ClaimPending → ClaimPaid` (USDC to
   the client + remainder to the provider) on `covered=true`, or back to `InitiallyApproved` (claim
   burned) on `covered=false`. It records the **evidence commitment** + `evaluatedAt` and emits
   `ConfidentialEvaluationResolved` (indexed by the subgraph).

**The report 7-tuple** (encode order):

| # | name | type | `onReport` validation |
|---|---|---|---|
| 0 | chainId | `uint256` | `== block.chainid` else `ReportDomainMismatch` |
| 1 | hub | `address` | `== address(this)` else `ReportDomainMismatch` |
| 2 | jobId | `uint256` | job lookup |
| 3 | covered | `bool` | branch selector |
| 4 | amount | `uint256` | if `covered`: `0 < amount <= guaranteeAmount` else `ZeroPayout` / `AmountAboveCap` |
| 5 | evidenceCommitment | `bytes32` | `!= bytes32(0)` else `BadCommitment` |
| 6 | evaluatedAt | `uint64` | `> 0` and `<= block.timestamp + SKEW` else `BadTimestamp` (advisory provenance, not a replay guard) |

- **`amount ∈ {0, guaranteeAmount}`** — secret-independent by construction.
- The contract **reverts, never clamps**, on a zero or over-cap amount (`ZeroPayout` /
  `AmountAboveCap`). The two NEW checks run **after** the `settled[jobId]` + `status==ClaimPending`
  checks, so a settled/wrong-state job surfaces the terminal `AlreadySettled`/`BadState` (a relay
  no-op), never a spurious `BadCommitment`/`BadTimestamp` a relay would retry.
- **REFUSE** emits no report at all; the permissionless `resolveClaimTimeout` closes the claim
  not-covered after the 3-day grace (no Cron backstop).

## 5. Trust assumptions — the honest model

Settlement **authorization** is gated (DON signature + forwarder + pinned workflow identity + domain
binding). Settlement **outcome** is not trust-minimized. State both plainly:

**Trust-minimized:**
- Criteria/threshold **secrecy** + computational integrity on a given input (the TEE).
- Settlement **authorization**: the only path to `ClaimPaid` is `onReport`, reachable only after
  DON-signature transport under the pinned workflow identity.
- Domain binding (`chainId`/`hub`) blocks cross-chain replay; `settled`/`claimFiled` latches;
  `amount ≤ cap`; funds routed to `job.client` / `job.provider` (a relay cannot self-pay).

**Trusted (documented caveats):**
- **The confidential test API is a trust root — a verdict-input authority in *both* directions.**
  `covered` is a function of the `passRate` the API returns. The API can *cause* a payout (return a
  low `passRate`) or *deny* one; combined with the single-claim burn, it holds a **payout veto**
  (any workflow-side non-payout — REFUSE / CLEAN_CLOSE / timeout — permanently burns the client's
  single claim). This is the sole payout gate, and it is not the Vouch backend.
- **A malicious EOA relay can mint a valid report for any `ClaimPending` job.** Arc testnet has **no
  canonical KeystoneForwarder**, so the CRE transport is a **trusted EOA relay** with no onchain
  DON-signature verification. Identity, domain, and commit are all public/forgeable, so those
  onchain checks defend against accidents, outsiders, and cross-chain replay — **not** against a
  compromised relay. The only real bounds are **client-recipient-binding** (payout goes to the job's
  client, not an arbitrary address) and **`amount ≤ cap`**.
- **Co-operation risk:** a single operator controlling **both** the test API and the relay
  reconstitutes *agent-as-authority* (the API mints the verdict input, the relay delivers it) — the
  exact pattern ADR-004 forbids. Only recipient-binding + cap prevent self-enrichment.
- **Per-node fetch consensus:** each DON node fetches the API independently; verdict consensus
  assumes the API returns identical bytes to all nodes in the window. A byzantine API can split
  quorum — which fails closed (liveness loss), not open. Response-pinning is production hardening.
- **The Vouch API backend (`apps/api`) genuinely cannot settle.** It holds no DON key, no forwarder
  role, and no workflow-identity match; `onReport` is unreachable from it.

**On attestation:** the SDK surfaces **no raw Nitro attestation document** — no accessor for
`attest`/`quote`/`measurement`. CRE generates an enclave attestation that DON consensus verifies
internally before releasing secrets and signing the report, but the app never sees it. The
submission does **not** claim a Nitro attestation. The externally-verifiable proof is the
**DON-signature-gated `onReport`** executed under the **pinned workflow identity**, plus (if enrolled)
the **Workflow Registry confidential attribute**.

## 6. Simulation / deployment

```bash
# 1. Install the CRE CLI and confirm flags/version
curl -sSL https://app.chain.link/cre/install.sh | bash && cre --version

# 2. Install deps (pins @chainlink/cre-sdk@1.20.1) + local sim env (SENTINEL_<uuid> values only)
pnpm --filter @vouch/cre-workflow install
cp packages/cre-workflow/.env.example packages/cre-workflow/.env
cp packages/cre-workflow/secrets.yaml.example packages/cre-workflow/secrets.yaml

# 3. Dry-run simulate (PRIMARY EVIDENCE — proves report generation + encoding; onchain writes are
#    dry-run by default). Repeat per fixture.
cre workflow simulate vouch-outcome-assurance --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload ./fixtures/valid-failure.json | tee docs/evidence/simulate-valid-failure.txt

# 4. Normalize volatile fields (log timestamps, dry-run 0x000… hashes) + write docs/evidence/MANIFEST
#    (command, cre --version, sdk version, per-file sha256) + run the blocking grep gate.

# 5. OPTIONAL broadcast (enrolled + funded relay + seeded ClaimPending job) → a real Arc tx.
cre workflow simulate ... --broadcast   # prefer NOT committing raw broadcast output; if committed, gate for real secrets
```

**Deterministic local harness (runnable fallback).** When the CRE CLI or a CRE account is
unavailable, the deterministic harness is the runnable stand-in — it exercises the same handler
through the `EvalPort` seam with a fixed clock and sentinel secrets:

```bash
node --import tsx harness.ts fixtures/valid-failure.json
```

**Blocking grep gate (must pass before committing any evidence):** a pattern scan (`Bearer `, long
hex, `api_key=`, the real test-API host) over **source and `docs/evidence/*`** — the gate is
pattern-based, not sentinel-only, so it also catches real secrets in any `--broadcast` output — **AND**
a positive assertion that **the run exercised the secret path** (a PAYOUT/CLEAN_CLOSE occurred).
"No sentinel found" is meaningless unless the secret path actually ran, so both conditions block.

Other gates: `pnpm --filter @vouch/cre-workflow lint|typecheck|test`;
`pnpm --filter @vouch/contracts test:contracts && abi:sync`;
`pnpm --filter @vouch/subgraph test`; then repo-wide `pnpm lint && typecheck && test && build`.

## 7. Evidence required by the Chainlink submission

Each artifact is labeled **TEE (`handlerInTee`) vs fallback** and **dry-run vs `--broadcast`**.

- [ ] **Sanitized `docs/evidence/simulate-*.txt`** per fixture (`valid-pass`, `valid-failure`,
      `invalid-commit`, `replay`, `timeout-error`) — **dry-run**, **TEE** where enrollment allows,
      **fallback**-labeled otherwise. Volatile fields normalized.
- [ ] **`docs/evidence/MANIFEST`** — the exact command, `cre --version`, `@chainlink/cre-sdk` version,
      and a per-file sha256.
- [ ] **Report-shape assertion** — 7-tuple only (dry-run; TEE-or-fallback, whichever produced it).
- [ ] **Reproducible opening JSON** for `evidenceCommitment` — schema/version + ABI type string +
      ordered public fields (incl. covered-failure-code + evaluated-commit) whose hash matches the
      onchain commitment (dry-run; public-safe).
- [ ] **DON-signature-gated `onReport` provenance** — the pinned workflow identity in `ReceiverBase`
      vs the registered workflow — the practical stand-in for a public attestation
      (dry-run for the identity check; the actual transition needs `--broadcast`).
- [ ] *(bonus, if enrolled/deployed)* Workflow Registry entry with the **confidential attribute** set
      (TEE, live).
- [ ] *(bonus)* a `--broadcast` **Arc tx hash** showing a real `ClaimPending → ClaimPaid` (TEE-or-
      fallback, broadcast).
- [ ] *(explicitly out of reach)* a raw Nitro attestation document — the SDK exposes none; the
      submission does not claim one.
- [ ] `docs/chainlink-confidential-workflow.md` (this file) + the honest trust caveats (§5).

## 8. Blocking pre-reqs

Everything is built and config-gated; live/TEE evidence is blocked only on external unknowns.

- [ ] **⚠️ VERIFY the Tenderly Virtual TestNet submission requirement [BLOCKING].** Owner decision
      2026-09-11: **verify the rules first.** Confirm against the exact ETHOnline / Convergence 2026
      submission rules whether an **Arc testnet explorer link** is accepted in lieu of a **Tenderly
      Virtual TestNet** link. Add a **parallel Tenderly deployment only if** the rules require it —
      do not build it speculatively.
- [ ] **Arc `chainSelectorName` resolves.** Confirm `getNetwork({chainFamily:"evm",
      chainSelectorName:"arc-testnet"})` returns non-falsy (selector `3034092155422581607`, bundled
      since SDK v1.3.1); the workflow throws on a falsy result.
- [ ] **CRE account / private-beta enrollment** for a live `handlerInTee` run (compiles + simulates
      now; the real enclave path needs enrollment). Without it, use the TEE-fallback (credential-only)
      or the deterministic local harness, labeled as such.
- [ ] `.env` + `secrets.yaml` confirmed git-ignored before any `cp` (sentinels only; never real
      credentials or private test content in the repo).
- [ ] For `--broadcast` only: a funded relay + a seeded `ClaimPending` job on Arc.

## 9. References

- **Repo:** [`packages/cre-workflow`](../packages/cre-workflow), `AssuranceHub.sol` (`onReport`,
  `ConfidentialEvaluationResolved`, `resolveClaimTimeout`), `ReceiverBase.sol`,
  [`docs/plans/2026-09-11-feat-confidential-post-completion-evaluation-plan.md`](plans/2026-09-11-feat-confidential-post-completion-evaluation-plan.md).
- **ADRs:** [002 — confidential verification via CRE TEE](decisions/002-confidential-verification-cre.md),
  [004 — payout authority / forwarder](decisions/004-payout-authority-forwarder.md),
  [005 — AssuranceHub settlement model](decisions/005-assurance-settlement-model.md).
- **Chainlink CRE:** [confidential workflows](https://docs.chain.link/cre/concepts/confidential-workflows) ·
  [making confidential HTTP requests](https://docs.chain.link/cre/guides/workflow/using-confidential-http-client/making-requests-ts) ·
  [core-ts SDK](https://docs.chain.link/cre/reference/sdk/core-ts) ·
  [EVM log trigger](https://docs.chain.link/cre/guides/workflow/using-triggers/evm-log-trigger-ts) ·
  [writing data onchain](https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/writing-data-onchain) ·
  [simulating workflows](https://docs.chain.link/cre/guides/operations/simulating-workflows).
