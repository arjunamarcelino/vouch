# Vouch — Security & Honest Trust Model

This document states, without overclaiming, **where trust actually sits**, what is and isn't
guaranteed, and how we verify no secret leaks. It is deliberately honest about the gaps — the
project's rule is *real output only, no faked guarantees*. Companion docs:
[`architecture.md`](architecture.md) (authority model), [`decisions/`](decisions/) (ADRs),
[`chainlink-confidential-workflow.md`](chainlink-confidential-workflow.md) §5 (CRE trust model).

---

## 1. Authority model — where every kind of state lives

| Concern | Authoritative store | Trust surface |
|---|---|---|
| Escrow, service fee, guarantee collateral, payouts | Arc `AssuranceHub` contract | Capped, idempotent, receiver-gated payout |
| Provider reputation / performance history | The Graph subgraph | Derived from minimal on-chain events (no on-chain aggregate) |
| UI cache, orchestration metadata, sessions | Postgres / Prisma | **Operational only** — rebuildable, never money/reputation |
| Private tests, criteria, repo credentials | CRE TEE (Vault DON) | Confidential from node operators; only a verdict leaves |

On-chain roles (`AssuranceHub` = `ReceiverBase, AccessControl, Pausable, ReentrancyGuard`):
- **`DEFAULT_ADMIN_ROLE`** — config/role only (`pause`/`unpause`, `setFeeRecipient`, timelocked
  `applyForwarder`/`applyExpectedWorkflow` behind `CONFIG_TIMELOCK`). It **cannot redirect principal
  to itself** (machine-checked by `test_NoAdminCanSeizeFunds`).
- **`EVALUATOR_ROLE`** — the *public* trust surface: `resolveInitialEvaluation` only. Cannot pay itself.
- **CRE receiver** (`onReport`) — the *confidential* trust surface, the only path that can trigger a
  payout; gated by the forwarder address **and** the packed workflow identity
  (`bytes32 workflowId | bytes10 workflowName | address workflowOwner`).
- **Pausable pauses entries, never exits** — `withdrawCollateral`/`cancelJob`/`expireJob`/
  `resolveClaimTimeout`/`onReport` stay callable while paused, so no rightful funds are ever trapped.

---

## 2. Money-safety invariants (the strong part)

Enforced and tested at every layer:
- **Payout is capped:** `serviceCredit = min(amount, guaranteeAmount)`; `amount > 0` and
  `amount ≤ guaranteeAmount` or the report reverts. Remainder returns to the provider.
- **Idempotent settlement:** `settled[jobId]` + `claimFiled[jobId]` latches → a replayed/settled
  report is a no-op (`AlreadySettled`), never a retryable double-pay. Subgraph mirrors this with
  `feeCounted`/`serviceFeeCounted`/`payoutCounted` latches.
- **Domain binding:** the 7-tuple report carries `chainId + hub`; a cross-chain or wrong-hub report
  reverts `ReportDomainMismatch`.
- **Solvency / conservation:** `usdc.balanceOf(hub) ≥ totalLiabilities` at every state (fuzzed), and
  **exact conservation with equality** across the three demo scenarios — verified by
  `AssuranceHub.conservation.t.sol` (client made whole, provider not double-charged, hub → 0 at
  terminal, total USDC conserved).
- **Confirmation discipline:** the API only marks a tx final after `confirmations ≥ 3` **and** an
  arg-hash + expected-event match (else `MISMATCH`); the web FSM shows success/explorer links **only**
  after a confirmed receipt. No API response is treated as final before on-chain confirmation.

---

## 3. Disclosed gaps (honest — do not overclaim)

These are **known and documented**, not accidental. State them plainly in any demo Q&A.

1. **No on-chain DON-signature verification on Arc testnet → trusted EOA relay.** Arc testnet exposes
   no canonical KeystoneForwarder, so the DON-signed report is delivered by a **trusted relay** and
   `onReport` authorizes on `msg.sender == forwarder` + workflow identity — **not** an on-chain
   signature check. Consequence: **whoever holds the forwarder EOA key can forge a `covered=true`
   report** for any `ClaimPending` job (bounded only by `amount ≤ guaranteeAmount` and recipient
   binding). This is agent-as-transport, **not** trust-minimized settlement. (ADR-004 B3.)
2. **TEE = input confidentiality, NOT attested output integrity.** `handlerInTee` (Nitro) keeps the
   private test/threshold/creds secret from node operators, but **nothing on-chain verifies a Nitro
   attestation** before trusting the verdict — integrity rests on the same trusted relay (gap #1).
   Also: `ConfidentialHTTPClient`'s `encryptOutput` **defaults to `false`**, so the test-API *response*
   is not encrypted end-to-end. This is intentional here — we adjudicate an **untrusted** response and
   declassify only the minimal verdict — but it is documented, not implied-away.
3. **Agent does not auto-post the guarantee bond.** `JobCreated` carries no `quoteId`, so the only
   autonomous on-chain action is an **operational quote-bond** via the manual/`AGENT_ALLOW_MANUAL_PAY`
   path. The agent **never** moves guarantee principal. "Autonomous" = quoting + operational payment,
   not settlement.
4. **No on-chain reputation aggregate.** Reputation exists **only** as indexed Graph data (ADR-003) —
   this makes The Graph load-bearing, but it also means a consumer pointed at a stale/wrong subgraph
   silently reads the wrong history. The freshness gate (below) is the mitigation.

---

## 4. Key & authority custody (money-critical single points of compromise)

Settlement integrity reduces to a small set of keys. For a real deployment these MUST be distinct,
minimally-scoped, and rotated; for the hackathon they are documented here so the risk is explicit.

| Secret / role | Guards | If compromised | Where it lives |
|---|---|---|---|
| **Forwarder EOA key** | `onReport` caller gate | **Total loss** — forge `covered=true` for any pending claim | relay operator; **never** in repo/DB/bundle |
| **`DEFAULT_ADMIN_ROLE`** | forwarder/workflow config (timelocked), pause, feeRecipient | Re-point settlement to an attacker workflow (after `CONFIG_TIMELOCK`) | admin EOA (multisig in prod; deployer EOA for demo) |
| Deployer key | contract deploys | Deploy a rogue hub | encrypted keystore; never committed |
| `QUOTE_SIGNER_PK` | EIP-712 quote signatures | Forge quotes (bounded — quotes aren't settlement authority) | agent env; **≠** any payment/deployer key |
| Circle API key + entity secret | agent wallet ops | Move the wallet's capped operational balance | agent env / Circle vault; policy-capped wallet holds minimal funds |
| CRE Vault-DON `token` / `PASS_THRESHOLD` | private test fetch + verdict | Read the private suite / invert criteria | **only** inside the enclave via Vault DON |

**Rule:** the forwarder key and admin key are the two that can cause a **total** loss of the assurance
guarantee. Keep them separate, off every developer machine, and (prod) behind a multisig + a monitor
on `Forwarder`/`ExpectedWorkflow` config-change events.

---

## 5. Confidentiality boundary & secret inventory

**What is confidential:** Vault-DON secrets, the private regression test content/criteria, the
pass-threshold, repo credentials, and intermediate enclave values. **What is NOT confidential** (and
therefore must never contain a secret): workflow **source/binary**, triggers, chain reads/writes,
on-chain metadata, subgraph entities, IPFS, Postgres, logs. Private test **logic is fetched at
runtime** inside the enclave — never inlined in source.

Enforcement is layered — each mechanism covers a specific surface. **`gate:secrets` covers tracked
source/config only**; it does **not** scan the built web bundle, the DB, or runtime logs (those are
logger redaction + the comprehensive-tier follow-ups below).

| Secret | Never appears in | Enforced by (per surface) |
|---|---|---|
| Repo token / API bearer | source/config → `gate:secrets`; runtime logs → redaction; on-chain/subgraph → design | Vault DON `{{.token}}` injection (never in node memory); logger redaction (logs); `gate:secrets` (tracked source: token-shape + secret-var scan) |
| Private test / criteria / `PASS_THRESHOLD` | anywhere outside the enclave | `getSecret` inside TEE; fetched at runtime; commitments-only on-chain |
| `QUOTE_SIGNER_PK` / Circle / deployer keys | tracked repo → `gate:secrets` + `.gitignore`; web bundle → `NEXT_PUBLIC_*` allowlist (not auto-scanned — see follow-ups) | `.gitignore`; `NEXT_PUBLIC_*` allowlist convention; `gate:secrets` (tracked source) |

On-chain events and subgraph entities carry **only** ids, amounts, addresses, booleans, and
**`bytes32` commitments** — never preimages, criteria, or failure strings.

### Secret-leak gate (`pnpm gate:secrets` → [`scripts/secret-scan.mjs`](../scripts/secret-scan.mjs))
Fails closed if a real secret file is tracked, if `.gitignore` misses `.env`/`secrets.yaml`, or if a
tracked non-example file contains (a) a self-identifying token shape (JWT / `ghp_` / `github_pat_` /
`AKIA` / Slack / PEM `PRIVATE KEY` / Circle key — flagged even in test/fixture files) or (b) a real,
high-entropy 64-hex value assigned near a secret-var name (all-same-char placeholders allowed; an
auditable `secret-scan-allow` directive marks intentional public test vectors). It also runs the CRE
harness as a **positive control** that asserts the harness *consumed* ≥1 secret, produced the
threshold-driven `PAYOUT` verdict, and did **not** echo the sentinel value — a harness that throws is
a failure, not a skip. **Scope:** tracked source/config only — not the built bundle, DB, or logs.
Verified non-vacuous: it flags a planted key (incl. in a `.test.ts`), a GitHub PAT, and a JWT, and
passes clean otherwise.

**Comprehensive-tier follow-ups** (enumerated, not all automated in the lean gate): scan the **built**
`.next` bundle for secret *values* (not just the allowlist file); confirm no sourcemaps ship original
source; confirm Prisma query logging is off in prod and the DB stores no secrets; scan **CI run
logs**; scan **git history** (a removed-but-committed secret persists — remediation is a history
rewrite, do it before branching); confirm wagmi/RainbowKit `localStorage`/`IndexedDB` holds nothing
sensitive; a redaction **canary** through the logger; a **boundary-flip** proof that the verdict is
read from the real secret threshold, not hardcoded.

---

## 6. Other honesty notes

- **`demo/reset` is offchain-only.** `POST /demo/reset` (double-gated: ADMIN allowlist + DemoService
  allowlist) clears job metadata/feed/sessions — it **never** touches Arc or the Graph and must not be
  mistaken for a genuine revocation/claim in the indexed feed during a live session.
- **Subgraph reorg-safety is implicit.** The subgraph has no explicit reorg logic; safety rests on
  graph-node's block-pointer rollback re-executing idempotent, event-derived arithmetic (latches live
  on the same rolled-back `Job`, so they roll back together). Matchstick can't test this — it is a
  documented reliance, not a claimed defense.
- **Partial-credit is reserved / integration-dead.** The contract supports `amount < guaranteeAmount`
  (`test_PartialCredit`), but the real CRE always emits `amount == guaranteeAmount` on a covered
  verdict — so a partial payout **cannot fire** via the live path. Documented so no one reads it as a
  shipping feature.
- **Demo state mutates reputation.** Running the covered-claim demo raises the provider's
  `upheldClaimRateBps`; a second rehearsal will not reproduce the same "before" price. Use fresh
  jobIds / a fresh provider per rehearsal.
