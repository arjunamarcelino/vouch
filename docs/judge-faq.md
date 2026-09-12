# Vouch — Judge FAQ

Hard questions, answered honestly. Each answer: **blunt claim → mechanism → citation.** The honest
boundaries here are design decisions, not apologies. Companion docs:
[`security.md`](security.md) (trust model), [`chainlink-confidential-workflow.md`](chainlink-confidential-workflow.md)
(CRE), [`architecture.md`](architecture.md) (authority).

> Not investment, legal, or insurance advice. Vouch is a hackathon protocol, deployed on Arc **testnet**.

---

## 1. Why does this need a blockchain?

**Because the confidential verdict is the *sole* payout gate, the reputation it produces is
tamper-evident, and settlement is authoritative, capped, and idempotent — a trusted server can be
overridden or silently edited; a receiver-gated `onReport` cannot.**

The only path to `ClaimPaid` is `AssuranceHub.onReport`, gated by the forwarder caller **and** the
packed workflow identity — no admin, evaluator, agent, or backend can reach it, and
`test_NoAdminCanSeizeFunds` proves even the admin cannot redirect principal. Payout is
`min(amount, guaranteeAmount)` and latched (`settled[jobId]`), so it is capped and can never
double-pay on replay; reputation is derived only from minimal on-chain events, so anyone can
recompute it and no one can quietly rewrite a provider's history. A server could do the arithmetic,
but its operator could also flip a verdict, edit the ledger, or pay twice — and no third party could
prove it happened.

Citations: `packages/contracts/src/ReceiverBase.sol:67,73` (forwarder + workflow-identity gate);
`packages/contracts/src/AssuranceHub.sol:407,415-423` (idempotent latch, capped payout);
`docs/security.md` §1-2.

## 2. Is this insurance? Is it regulated?

**No. It is a self-funded, capped, provider-posted performance guarantee — no premiums, no
underwriting, no pooled risk.**

The provider voluntarily posts its own collateral on its own job (`acceptJob`), and the payout is
capped at that provider-funded amount — there is no third-party premium, no risk pool, no
underwriting entity, and no transfer of risk to policyholders. That structure is deliberately outside
the definitional core of insurance (pooled premiums covering third-party risk); it is closer to a
capped, self-collateralized warranty on one's own work. We make no jurisdiction-specific regulatory
claim beyond that posture, and nothing here is investment, legal, or insurance advice.

Citations: `packages/contracts/src/AssuranceHub.sol` (`acceptJob` posts provider collateral; payout
capped at `guaranteeAmount`, line 417); vouch-facts "NOT general insurance".

## 3. Who decides a covered failure? What stops a fake claim?

**A private regression test running inside the CRE TEE is the sole authority — and a layered
anti-griefing stack makes a fake claim uneconomic and self-limiting.**

The covered/not-covered verdict is a pure function of a `passRate` from a private test suite the
claimant can't see, computed inside the enclave; the claimant cannot invert criteria they can't read.
The stack: a `bytes32` submission/private commitment binds what was evaluated; the workflow
**fails closed** to `REFUSE` (emits nothing) on any inconclusive input; the `claimFiled`/`settled`
latches give each job exactly one claim (a rejected claim burns the coverage, so spamming claims is
strictly self-harming); payout is capped at `min(amount, guaranteeAmount)`; and if the DON never
reports, the permissionless `resolveClaimTimeout` closes the claim not-covered after the grace period
so no one can strand a provider's collateral.

Citations: `packages/contracts/src/AssuranceHub.sol:407-408,415-418,446` (latches, cap, timeout);
`packages/cre-workflow/workflow.ts:213-224` (`handlerInTee`); `docs/chainlink-confidential-workflow.md`
§2-4; `docs/security.md` §2.

## 4. How can judges trust the verdict?

**On testnet, trust it as far as a trusted EOA relay — no more, and we say so plainly. The TEE
guarantees input confidentiality; an attested-DON path is the mainnet roadmap.**

Inside the enclave, `handlerInTee` (Nitro, `us-west-2`) keeps the private test, threshold, and
credential secret from node operators, and `onReport` is gated by the forwarder plus the pinned
workflow identity. What testnet does **not** yet have: Arc testnet exposes no canonical
KeystoneForwarder, so the DON-signed report is delivered by a trusted relay EOA and authorized on
`msg.sender == forwarder`, not an on-chain DON-signature check — whoever holds that key could forge a
`covered=true` report (bounded only by `amount ≤ cap` and client-recipient binding). This is a
disclosed boundary, and it is compliant: the Chainlink Confidential Workflow track explicitly accepts
a CRE-CLI **simulation** as evidence (a live enclave deploy is not required — Confidential Workflows
are private beta), and our simulate + harness evidence satisfies that rule.

Citations: `packages/cre-workflow/workflow.ts:213,223` (TEE + nitro constraint);
`packages/contracts/src/ReceiverBase.sol:67,73`; `docs/security.md` §3.1-3.2, §4;
`docs/chainlink-confidential-workflow.md` §5, §8; `docs/evidence/simulate-cli-payout.txt`.

## 5. Is the agent actually autonomous?

**Yes for what it claims: it autonomously posts real reputation-priced USDC quote-bonds on-chain. It
is transport, never the guarantee authority — by design.**

The agent watches for job openings, computes a live risk quote as a pure function of indexed subgraph
data, and posts/refunds a real operational bond via Circle developer-controlled-wallet
contract-execution (real txs: `postBond` `0x5d9d1af8…`, `refundBond` `0xd668c466…`). What it
deliberately does **not** do: settle the guarantee principal. `JobCreated` carries no `quoteId`, so
the job→bond-release linkage is a disclosed, logged no-op — the guarantee payout is reachable only
through the CRE `onReport` receiver path. ADR-004 forbids the agent from ever being the
payout authority, so "autonomous" means quoting + operational payment, not settlement.

Citations: `apps/agent/src/pay/executor.ts:128,134` (`postBond`/`refundBond` via DCW);
`apps/agent/src/index.ts:67-71` (disclosed logged no-op); `docs/security.md` §3.3; ADR-004.

## 6. Isn't a trusted relay on testnet just centralized?

**On testnet, yes — deliberately, because Arc testnet has no canonical forwarder to verify a DON
signature against. The confidentiality guarantee survives it; the integrity guarantee is the mainnet
upgrade.**

With no on-chain KeystoneForwarder, the DON-signed report is carried by a trusted EOA relay and
`onReport` authorizes on caller + workflow identity, not a signature check — so a compromised relay is
a documented single point of failure, mitigated only by client-recipient binding and the amount cap.
Crucially this does not touch confidentiality: the TEE still hides the private test, threshold, and
credential from every operator, so the *inputs* remain secret regardless of who relays the *output*.
The mainnet roadmap is the attested-DON path (on-chain DON-signature verification via a real
forwarder), which closes the gap without changing the app.

Citations: `packages/contracts/src/ReceiverBase.sol:67`; `docs/security.md` §3.1-3.2, §4 (forwarder
key = total-loss surface); `docs/chainlink-confidential-workflow.md` §5.

## 7. Isn't locking capped collateral per job capital-inefficient?

**Yes, and that inefficiency is the point — it buys self-funded, pool-free coverage with zero
counterparty solvency risk.**

Vouch is not an underwriting pool amortizing one reserve across many policies; it is a per-job,
provider-funded guarantee, so the collateral is locked precisely because there is no pool to socialize
it against. The provider chooses whether the trade is worth it: the agent's live, reputation-priced
risk quote (a pure function of indexed history — `upheldClaimRateBps`, `recentFailureRateBps`,
`jobsCompleted`) tells the provider exactly what its risk costs before it locks anything, and a worse
history raises the premium and lowers the cap. This is a warranty product, not a general insurance
product, and it is not meant to be capital-optimal across a book of risk.

Citations: `apps/agent/src/graph/client.ts:96` (`getProviderRisk`), `apps/agent/src/risk/score.ts`
(pure scoring, stamped `asOfBlock` + `scoringFnVersion`); vouch-facts (ADR-003, reputation loop).

## 8. Known limitations (volunteered)

These are documented boundaries, stated so no one has to discover them.

- **Trusted EOA relay on testnet (no on-chain DON-sig).** Forwarder-key holder could forge a covered
  report, bounded by cap + recipient binding. Mainnet fix: attested-DON forwarder. (`security.md` §3.1)
- **TEE = input confidentiality, not attested output integrity.** The SDK exposes no raw Nitro
  attestation; nothing on-chain verifies one. `encryptOutput` defaults `false` (we adjudicate an
  untrusted response and declassify only the verdict). (`security.md` §3.2)
- **Confidential test API is a trust root in both directions.** It can cause or veto a payout; a
  single operator holding both the API and the relay reconstitutes agent-as-authority (only cap +
  recipient binding prevent self-enrichment). (`chainlink-confidential-workflow.md` §5)
- **One claim per coverage window.** A not-covered verdict burns the claim latch, so a later covered
  failure in the same window cannot be re-filed — intentional MVP behavior. (`security.md` §6,
  `AssuranceHub.sol:434-437`)
- **Partial-credit is reserved / integration-dead.** The contract supports `amount < guaranteeAmount`,
  but the live CRE always emits `amount == guaranteeAmount` on covered, so partial payout cannot fire
  via the live path. (`security.md` §6)
- **No on-chain reputation aggregate.** Reputation lives only as indexed Graph data; a consumer
  pointed at a stale/wrong subgraph reads wrong history. Mitigation: agent's fail-closed freshness gate
  (`SUBGRAPH_STALE/LAGGING/UNAVAILABLE` → 503). (`security.md` §3.4, `apps/agent/src/graph/client.ts:17`)
- **Existence/timing side-channel (accepted).** A definitive clean pass emits immediately; an
  inconclusive REFUSE emits nothing until timeout, so an observer can distinguish the two. Coarse leak,
  noted. (`chainlink-confidential-workflow.md` §3)
- **`demo/reset` is offchain-only.** It clears operational metadata and never touches Arc or the
  Graph — don't mistake it for a real on-chain revocation. (`security.md` §6)
- **Mainnet is config + checklist only.** No real-value mainnet deploy without written authorization;
  Arc mainnet USDC predeploy is not yet published, so it is never hardcoded. (vouch-facts)
