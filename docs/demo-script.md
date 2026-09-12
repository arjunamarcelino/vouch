# Vouch — Master Demo Script (≤ 5 minutes)

> **The thesis (say this out loud at the close):**
> **"The job was validly accepted and paid — but assurance still protected the client from a
> later, covered failure."**

This is the **single master run** for the ETHOnline 2026 submission. It walks the full canonical
lifecycle once and ends on the thesis. Per-track deep-dives live in
[`demo-script-graph.md`](demo-script-graph.md), [`demo-script-arc.md`](demo-script-arc.md), and
[`demo-script-chainlink.md`](demo-script-chainlink.md); the 6-step video narration lives in
[`demo-flow.md`](demo-flow.md); the operator runbook is
[`runbooks/deployment-runbook.md`](runbooks/deployment-runbook.md).

> **Honesty rule (non-negotiable):** show **real output only**. No faked transactions, no
> hard-coded chain results. Any unconfigured leg shows its explicit **"not configured"** state — we
> never stage around it. Run [`pnpm demo:health`](../scripts/preflight-demo.mjs) immediately before
> recording; every leg you intend to show must be 🟢 (unconfigured legs are honest, but don't narrate
> them as live).

---

## What is authoritative where (say this once, early)

- **Money & lifecycle:** the Arc `AssuranceHub` contract (escrow, guarantee, capped + idempotent
  payout). **The Graph:** provider reputation, derived from events. **Postgres:** display/orchestration
  only — rebuildable, never money. **CRE TEE:** the only place the private test / criteria / repo
  creds live; only a verdict leaves the enclave.

---

## Pre-record checklist (≈1 min, off-camera)

- [ ] `pnpm demo:health` → the legs you'll show are 🟢 (Arc RPC + chainId 5042002, `AssuranceHub`
      bytecode, subgraph indexing, agent/api health).
- [ ] `pnpm gate:secrets` → PASSED (proves no secret leaks before you show any terminal/logs).
- [ ] Arc wallet funded (native gas + USDC from faucet); a real `testnet.arcscan.app` tx link opens.
- [ ] CRE local harness runs clean: `pnpm --filter @vouch/cre-workflow simulate:harness
      fixtures/valid-failure.json` — verdict `PAYOUT`, **no secret in the output**.
- [ ] Total runtime ≤ 5:00.

---

## The run (target 5:00)

| Time | Beat | On screen | Say |
|---|---|---|---|
| **0:00** | **Problem** | Landing page / one slide | "Acceptance tests are point-in-time. AI code can pass the public suite, get accepted and **paid**, then a regression only a **private** test catches shows up later. Once the fee is released, the client has no recourse. Vouch fixes exactly that." |
| **0:35** | **1–2 · Create + guarantee** | `/jobs/new` → approve + `openJob` (20 USDC task fee); provider `acceptJob` locks **100 USDC** collateral | "A client funds a 20-USDC coding job. A provider voluntarily locks a **100-USDC** capped guarantee. That lock **is** the agreement — negotiated off-chain, enforced on-chain." |
| **1:15** | **3–4 · Live risk quote (The Graph)** | Agent quote endpoint / `/providers/[address]`: `upheldClaimRateBps`→`premiumBps`, stamped `asOfBlock` + `scoringFnVersion` | "The risk agent queries the provider's **live** history from The Graph and signs a quote from real indexed signals — no fixture, no DB mirror. Stale the index and it **refuses** (503). The Graph is load-bearing." |
| **1:55** | **5 · Fund + settle on Arc (Circle Agent Stack)** | Agent's Circle wallet USDC balance; the real `postBond` tx open on `testnet.arcscan.app` | "Settlement is real USDC on Arc. The agent's **policy-capped Circle wallet** moves funds via **contract execution** — here's the confirmed transaction on arcscan. Honest scope: the agent is **transport**, it posts an operational quote-bond; it **never** settles the guarantee principal." |
| **2:40** | **6–8 · Commit → public tests → fee released** | `/jobs/[id]`: `submitDeliverable` (commit hash) → evaluator `resolveInitialEvaluation(approve)` → **20 USDC task fee → provider**, service fee → feeRecipient, coverage opens | "Provider submits a commit hash. Public tests pass, the evaluator approves — **the 20-USDC fee is released**. This job was **validly accepted and paid.** And now a 24-hour **coverage window** opens." |
| **3:15** | **10–11 · Open claim → CRE confidential test** | `/jobs/[id]/claim` → CRE progress; terminal: `simulate:harness fixtures/valid-failure.json` | "Within coverage, the client opens a claim. A **Chainlink CRE Confidential Workflow** runs the **private** regression test **inside a TEE** (`handlerInTee`, Nitro). Watch the log — the repo token and the private test **never appear.**" |
| **3:50** | **12–14 · Covered failure → payout** | Harness verdict `PAYOUT` (7-tuple) → `onReport` → events `GuaranteePaid` + `CollateralReleased`, state → `ClaimPaid`; UI shows **100 USDC → client** | "The confidential test proves a **covered** failure. The DON-signed 7-tuple verdict is the **sole gate** on the payout: `onReport` finalizes the claim and the client receives the **100-USDC** service credit. (There's no `ClaimPaid` event — the money events are `GuaranteePaid` + `CollateralReleased`.)" |
| **4:20** | **15–16 · Graph indexes → re-quote rises** | Feed shows indexed claim + payout; re-run the agent quote for the same provider (after `_meta.block ≥ payout block`) | "The Graph indexes the claim and payout. Ask for a **new quote** on the same provider — the upheld claim raised `upheldClaimRateBps`, so the premium is **higher** and the offered cap **lower**. Reputation is live and consequential." |
| **4:45** | **Close** | Slide with the thesis line | **"The job was validly accepted and paid — but assurance still protected the client from a later, covered failure. That post-acceptance, confidential coverage window is Vouch."** |

---

## The two other outcomes (20-sec appendix, optional)

Vouch is honest about the non-payout paths — show either quickly if time allows (both are covered by
`AssuranceHub.conservation.t.sol`, all with equality-checked money conservation):

- **No claim → collateral returns.** Coverage expires with no claim; provider calls
  `withdrawCollateral` → state `Completed`, `CollateralReleased` returns the 100 USDC. "No failure,
  no payout — the provider gets their collateral back, in full."
- **Rejected claim → no funds move.** The confidential test finds **no** covered failure
  (`simulate:harness fixtures/valid-pass.json` → `CLEAN_CLOSE`); `onReport(covered=false)` returns the
  job to `InitiallyApproved` — **no funds move** — and the collateral returns after coverage. "The
  guarantee pays **only** on a proven covered failure. This one wasn't."

---

## Honest trust model (have this ready for judge Q&A)

- **Settlement authority on Arc testnet is a *trusted EOA relay*** — there is no canonical
  KeystoneForwarder, so there is **no on-chain DON-signature verification** yet. The verdict's
  *integrity* rests on that relay + the workflow-identity/forwarder gate; the TEE guarantees
  *confidentiality of inputs*, not attested integrity of the output. (Full model:
  [`security.md`](security.md), [`chainlink-confidential-workflow.md`](chainlink-confidential-workflow.md) §5.)
- **What's autonomous:** the agent autonomously **quotes** from live Graph data and posts an
  **operational quote-bond**. It does **not** auto-post the guarantee and **never** moves guarantee
  principal.
- **CRE simulate is a single local node**, not proof of on-chain delivery. For an EVM-log trigger the
  CLI uses `--evm-tx-hash`/`--evm-event-index`, not `--http-payload`.
