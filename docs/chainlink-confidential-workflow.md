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

## 6. End-to-end deployment runbook (follow top to bottom)

> **Living runbook.** These are the exact, ordered steps to stand up the confidential-evaluation path
> end to end. Legend: **✅ verified working now** (run it as-is) · **⚠️ needs external access** (Arc RPC
> + funds / a CRE account / a Graph Studio key) · **🔁 repeat per fixture**. Do the ✅ steps to validate
> locally today; the ⚠️ steps are the live deploy once access is granted. Nothing here fabricates a
> result — if a step needs access you don't have, use its documented fallback.

### 6.0 Toolchain setup (one-time) — ✅
```bash
# Node 22 (matches .nvmrc) + pnpm 10 + Foundry
nvm install && nvm use                 # reads .nvmrc (22)
corepack enable && corepack prepare pnpm@10.29.2 --activate
curl -L https://foundry.paradigm.xyz | bash && foundryup
pnpm install                           # root; installs @chainlink/cre-sdk@1.20.1 (zod v3) for cre-workflow

# Sanity: everything green before you deploy anything
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm --filter @vouch/contracts test:contracts      # 60 forge tests
pnpm --filter @vouch/subgraph test                 # 14 matchstick tests
forge --version
```
```bash
# CRE CLI — needed only for `cre workflow simulate` / secrets (⚠️ install + `cre login` need a CRE account).
curl -sSL https://app.chain.link/cre/install.sh | bash && cre --version   # docs cite v1.32.0
# No CLI/account yet? Skip to the harness in 6.6 — it validates the full logic path locally today.
```

### 6.1 Environment & secrets — ✅ (files) / ⚠️ (real values)
```bash
cp .env.arc-testnet.example .env.arc-testnet          # root: chain/USDC/RPC/deploy + subgraph vars
cp packages/cre-workflow/.env.example packages/cre-workflow/.env          # local-sim ONLY (SENTINELs)
cp packages/cre-workflow/secrets.yaml.example packages/cre-workflow/secrets.yaml
# Confirm both are git-ignored BEFORE putting any real value in them:
git check-ignore packages/cre-workflow/.env packages/cre-workflow/secrets.yaml .env.arc-testnet
```
Fill `.env.arc-testnet`: `ARC_RPC_URL` (confirm host — `.network` vs `.io`, plan §17.1),
`USDC_ADDRESS` (`0x3600…0000`, verify at docs.arc.io), and a funded deployer key
(prefer an encrypted keystore over a raw `PRIVATE_KEY`). For local sim only, put high-entropy
`SENTINEL_<uuid>` values in `packages/cre-workflow/.env` — **never** a real credential or private test.

### 6.2 Decide the CRE identity BEFORE deploying the contract — ✅ (choose) / decisions
The AssuranceHub constructor bakes in the forwarder + workflow identity, and the workflow's config must
reuse the SAME values, so choose them first and export them for the deploy:
```bash
export ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
export CRE_FORWARDER_ADDRESS=<forwarder>     # ⚠️ Arc testnet has NO canonical KeystoneForwarder →
                                             #    this is your TRUSTED EOA relay address (ADR-004/§5 caveat)
export CRE_WORKFLOW_ID=$(cast keccak "vouch-assurance-v1")     # bytes32 (matches the contract tests)
export CRE_WORKFLOW_NAME=$(cast format-bytes32-string "vouchclaim")  # bytes10 = leading 10 bytes of this
export CRE_WORKFLOW_OWNER=<workflow-owner-address>
export ADMIN_ADDRESS=<admin> EVALUATOR_ADDRESS=<evaluator> FEE_RECIPIENT_ADDRESS=<feeRecipient>
export PRIVATE_KEY=<deployer-pk>             # or use --account <keystore>
export ARC_TESTNET_RPC_URL=$ARC_RPC_URL
```
> The workflow's report metadata is `abi.encodePacked(workflowId, workflowName, workflowOwner)`; the
> receiver rejects any report whose identity ≠ these. Reuse the exact same three values in 6.5.

### 6.3 Deploy the settlement contract to Arc testnet — ⚠️ needs RPC + funds
```bash
cd packages/contracts
forge build                                        # ✅
forge script script/Deploy.s.sol:Deploy \
  --rpc-url arc_testnet --broadcast \
  --verify --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/  # Arcscan is Blockscout; the key is ignored
# Record the deployed AssuranceHub address from the broadcast output:
export ASSURANCE_HUB=<deployed-address>
# (optional Track-D escrow) forge script script/DeployEscrow.s.sol:DeployEscrow --rpc-url arc_testnet --broadcast
pnpm --filter @vouch/contracts abi:sync            # ✅ keep shared + subgraph ABIs in lockstep
```

### 6.4 Deploy the subgraph — ⚠️ needs Graph Studio key OR a local graph-node
```bash
cd packages/subgraph
# Point the manifest at the deployed hub + its deploy block (networks.json → address/startBlock).
pnpm codegen && pnpm build && pnpm test            # ✅ (test is local)
# Studio:
graph auth $GRAPH_DEPLOY_KEY && pnpm deploy:studio --version-label "$SUBGRAPH_VERSION"
# …or fully local:  pnpm create:local && pnpm deploy:local
# Then record SUBGRAPH_URL + SUBGRAPH_DEPLOYMENT_ID (Qm…) in .env.arc-testnet and:
pnpm health-check                                  # asserts synced / no indexing errors / lag budget
```

### 6.5 Configure the CRE workflow — ✅ (edit) / verify
Edit `packages/cre-workflow/config.staging.json` (all `0x0…0` placeholders are REJECTED at startup by
the non-zero refine, so real values are mandatory):
```jsonc
{
  "chainSelectorName": "arc-testnet",       // must resolve via getNetwork() (selector 3034092155422581607)
  "chainId": "5042002",                     // must equal arc-testnet block.chainid (config refine checks this)
  "assuranceHubAddress": "<ASSURANCE_HUB>", // the 6.3 address (log trigger + getJob + report hub + writeReport)
  "owner": "<CRE_WORKFLOW_OWNER>",          // Vault secret-owner scope for {{.token}}
  "gasLimit": "500000",
  "testApiUrl": "https://<your-confidential-test-api>/evaluate",
  "workflowId": "<CRE_WORKFLOW_ID>"         // the SAME bytes32 baked into the contract in 6.2
}
```
Set `project.yaml` rpcs → `${ARC_TESTNET_RPC_URL}`; set `workflow.yaml` workflow-name. Provision the
runtime secrets into the Vault DON (⚠️ needs `cre login`):
```bash
cd packages/cre-workflow
cre secrets create secrets.yaml --target staging-settings   # token, PASS_THRESHOLD, PRIVATE_TEST_REF
pnpm typecheck && pnpm test && pnpm lint                     # ✅ 46 tests
```

### 6.6 Simulate — primary evidence — ✅ logic (harness) / ⚠️ CLI needs account
```bash
cd packages/cre-workflow
# A) Deterministic local harness — WORKS NOW, no CLI/account. Proves the full decision+encode path.
node --import tsx harness.ts fixtures/valid-failure.json      # PAYOUT
node --import tsx harness.ts fixtures/valid-pass.json         # CLEAN_CLOSE
node --import tsx harness.ts fixtures/timeout-error.json      # REFUSE
# B) Official CRE CLI dry-run (⚠️ needs cre login) — the submission evidence. 🔁 per fixture.
cre workflow simulate vouch-outcome-assurance --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload ./fixtures/valid-failure.json | tee ../../docs/evidence/simulate-valid-failure.txt
```
Then **sanitize** (normalize log timestamps + the dry-run `0x000…` hashes), write
`docs/evidence/MANIFEST` (exact command, `cre --version`, `@chainlink/cre-sdk` version, per-file
sha256), and run the **blocking grep gate** before committing any evidence: a pattern scan
(`Bearer `, long hex, `api_key=`, the real test-API host) over **source and `docs/evidence/*`** — not
sentinel-only, so it also catches real secrets in `--broadcast` output — **AND** a positive assertion
that the run exercised the secret path (a PAYOUT/CLEAN_CLOSE occurred). Both conditions must pass.

### 6.7 Live settlement (optional bonus) — ⚠️ needs enrollment/relay + a seeded job
A report can only settle a job that is already `ClaimPending`. Seed one, then deliver the report:
```bash
# Seed the lifecycle with cast (client & provider must approve USDC to $ASSURANCE_HUB first):
cast send $ASSURANCE_HUB "openJob(address,address,uint256,uint256,uint256,uint64,uint64,bytes32,bytes32)" \
  <provider> $ARC_USDC_ADDRESS <taskFee> <guarantee> <serviceFee> <submitDeadline> <coverageDur> \
  <publicHash> <privateCommit> --rpc-url arc_testnet --private-key <client-pk>
cast send $ASSURANCE_HUB "acceptJob(uint256)" <jobId> --private-key <provider-pk> --rpc-url arc_testnet
cast send $ASSURANCE_HUB "submitDeliverable(uint256,bytes32)" <jobId> <submissionCommitment> --private-key <provider-pk> --rpc-url arc_testnet
cast send $ASSURANCE_HUB "resolveInitialEvaluation(uint256,bool)" <jobId> true --private-key <evaluator-pk> --rpc-url arc_testnet
cast send $ASSURANCE_HUB "openClaim(uint256,bytes32)" <jobId> <evidenceCommitment> --private-key <client-pk> --rpc-url arc_testnet
# Now the ClaimOpened log fires the workflow. Deliver the DON-signed report:
#  (a) enrolled + real forwarder: `cre workflow simulate … --broadcast` → writeReport → forwarder → onReport
#  (b) trusted EOA relay (Arc today): the relay calls
#      onReport(abi.encodePacked(CRE_WORKFLOW_ID,CRE_WORKFLOW_NAME,CRE_WORKFLOW_OWNER), <7-tuple report bytes>)
cast call $ASSURANCE_HUB "getJob(uint256)" <jobId> --rpc-url arc_testnet   # expect status 6 = ClaimPaid
```
> `submissionCommitment` (6.7) MUST equal the `commitHash` the test API returns, or the workflow REFUSEs
> (and, if you enabled the optional onchain check, `onReport` reverts `CommitMismatch`). If the DON never
> reports, anyone may call `resolveClaimTimeout(jobId)` after the 3-day grace to release the claim.

### 6.8 Verify end-to-end — ⚠️ (post-broadcast)
- Arcscan (`$ARC_EXPLORER_URL/tx/<hash>`): `ConfidentialEvaluationResolved(jobId, covered, credit,
  evidenceCommitment, evaluatedAt)` + `GuaranteePaid` emitted; USDC moved to the client.
- Subgraph: the `ConfidentialEvaluation` entity carries `evidenceCommitment` + `evaluatedAt`; the job
  status is `CLAIM_PAID`. Confirm with `pnpm --filter @vouch/subgraph health-check`.
- Reproduce the `evidenceCommitment` off-chain from the opening JSON (§7) and confirm it matches the
  onchain value.

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

- [x] **✅ Tenderly Virtual TestNet requirement — VERIFIED 2026-09-11: NOT required for this track.**
      Per the official [Convergence prizes page](https://chain.link/hackathon/prizes) and
      [FAQ](https://chain.link/hackathon/faq): the general submission requirement is to
      "Build, simulate, or deploy a CRE Workflow… demonstrate a successful **simulation (via the CRE
      CLI)** or a live deployment on the CRE network." A Tenderly Virtual TestNet explorer link is
      mandated **only for the Tenderly-specific track**, not the Confidential Workflow track. The FAQ
      confirms local runs are fine ("You can run your application locally. You'll just need a working
      demo") alongside a 3–5 min video. **Conclusion:** the `cre workflow simulate` evidence path (and
      the `harness.ts` fallback) fully qualifies; **no parallel Tenderly deployment is needed.** No
      testnet whitelist is published, so confirm Arc is CRE-supported or rely on the accepted CLI-sim
      path (chain-agnostic). Required artifacts: 3–5 min public video, public repo, README linking all
      Chainlink files, and the CRE sim/deploy shown in the video.
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
