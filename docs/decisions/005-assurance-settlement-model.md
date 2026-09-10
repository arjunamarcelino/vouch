# ADR-005 — AssuranceHub settlement model

**Status:** Accepted (per plan §19 Resolved Decisions — supersedes the placeholder `VouchCore`)

## Context

The scaffold shipped a placeholder `VouchCore.sol` with a thin `Created → GuaranteeLocked →
CoverageOpen → Settled/Cancelled` lifecycle. Implementing the full outcome-assurance protocol on
Circle Arc surfaced a set of design decisions that needed to be locked before the settlement
contract, the subgraph, the shared ABI, and the agent could be built in lockstep. `AssuranceHub`
is the canonical settlement contract that replaces `VouchCore`; this ADR records the model it
implements.

The protocol has two irreducible trust surfaces that must be kept separate: a **public** evaluation
of the provider's submission, and a **confidential** evaluation of a coverage claim that can move
guarantee funds. It also has to stay solvent while pooling many jobs' funds in one contract, and it
has to guarantee that no party's money can ever be trapped — including when the confidential
verdict never arrives.

## Decision

### 1. `AssuranceJob` lifecycle + single `openJob`

The contract implements the `AssuranceJob` state machine:

`Funded → AcceptedByProvider → Submitted → InitiallyApproved → (ClaimPending → ClaimPaid) |
Completed`, with `Cancelled` / `Expired` as refund exits.

Job **creation and client funding are merged into one `openJob` transaction** (plan §19 D2). There
is no separate `Created` state: `openJob` validates the terms, auto-assigns a `jobId`, escrows
`taskFee + serviceFee`, sets status to `Funded`, and emits `JobCreated` then `JobFunded` in the same
tx. This removes an inert intermediate state and the front-running surface of a client-supplied id.
`cancelJob` is therefore callable only from `Funded`.

### 2. Global `EVALUATOR_ROLE` + global CRE receiver — the trust split

Authority is split (`AssuranceHub is ReceiverBase, AccessControl, Pausable, ReentrancyGuard`; it
drops `Ownable2Step`):

- **`EVALUATOR_ROLE`** (global, owner-settable) resolves the *public* submission via
  `resolveInitialEvaluation` — approve (task fee → provider, service fee → `feeRecipient`, coverage
  opens) or reject (refund client, return collateral). It is a trusted liveness/correctness oracle:
  it can reject all jobs or approve garbage, but it can never pay itself.
- **CRE receiver** (`ReceiverBase`: forwarder + workflow identity) is the *only* path that finalizes
  the *confidential* claim (`onReport`) and can trigger a guarantee payout.
- **`DEFAULT_ADMIN_ROLE`** holds config and role management only (`queueForwarder`/`applyForwarder`,
  `queueExpectedWorkflow`/`applyExpectedWorkflow` — both behind a 2-day timelock, see hardening §
  below — plus `setFeeRecipient`, `pause` / `unpause`). No admin function moves principal; this is
  machine-checked by `test_NoAdminCanSeizeFunds`.

`Pausable` **pauses entries, never exits**: liability-growing entries (`openJob`, `acceptJob`,
`submitDeliverable`, `resolveInitialEvaluation`) are `whenNotPaused`, while every fund exit
(`withdrawCollateral`, `cancelJob`, `expireJob`, `resolveClaimTimeout`, `onReport`) stays callable
while paused. `unpause` is admin-only.

### 3. Off-chain-negotiated guarantee terms; provider acceptance is the agreement (§19 D1)

`openJob`'s `guaranteeAmount` encodes **off-chain-negotiated terms** derived from the agent's risk
quote. There is no on-chain provider counter-offer: the provider's `acceptJob`, which locks exactly
`guaranteeAmount` as collateral, **is** the agreement. Job parameters therefore represent agreed
terms, not a unilateral client demand.

### 4. Service fee → configurable `feeRecipient` (protocol revenue, not principal)

The optional `serviceFee` is escrowed alongside the task fee and routed to a configurable
`feeRecipient` at initial approval (emitting `ServiceFeePaid`). It is **protocol revenue, distinct
from principal** — the task fee and the provider's collateral are the only principal, and only those
are covered by the "no admin can seize funds" invariant. An admin may set `feeRecipient` (including
to itself); the fee is not refundable principal.

### 5. Solvency invariant

The contract maintains a `totalLiabilities` counter (escrowed task + service fees plus locked
collateral still owed): `+=` on every escrow-in, `-=` by the exact amount on every out-transfer.
The core invariant is **`usdc.balanceOf(this) >= totalLiabilities`** (`>=`, tolerating
donation/dust), enforced by an invariant test suite. Because funds for many jobs are pooled, every
refund/payout branch must decrement `totalLiabilities` by the exact amount it moves, and
`cancelJob` must branch on pre-state so it never drains another job's escrow.

### 6. `ReceiverBase` packed-metadata fix

Real Keystone metadata is **packed**, not `abi.encode`d. `ReceiverBase._decodeMetadata` slices by
offset — `bytes32 workflowId | bytes10 workflowName | address workflowOwner` (62 bytes; production
forwarders append a 2-byte `reportId` for 64) — and requires `length >= 62`. The receiver gate
checks `workflowId`, `workflowName`, and `workflowOwner` in addition to the forwarder address. (The
prior `abi.decode(metadata, (bytes32, address))` was wrong and would have rejected every real
report.) The confidential report payload the receiver decodes is
`abi.encode(uint256 jobId, bool covered, uint256 amount)`.

### 7. BLOCKER B1 — claim-resolution timeout (§19 D3)

`ClaimPending`'s only intended exit is `onReport`. If the CRE relay never delivers a verdict
(plausible — see §8 below), collateral would be stranded forever, violating the "at least one
non-pausable exit per party" invariant. Fix: `openClaim` stamps a `claimResolutionDeadline`
(`now + CLAIM_RESOLUTION_GRACE`); a permissionless, non-pausable **`resolveClaimTimeout(jobId)`**
becomes callable after it and treats the claim as **not-covered → `InitiallyApproved`** (no funds
move), so the provider can `withdrawCollateral` after `coverageEnd`. Default policy is
**return-to-provider**: coverage lapsed without a confidential proof of a covered failure.

### 8. BLOCKER B3 — the forwarder trust caveat (state plainly, do not bury)

Arc testnet exposes **no verified KeystoneForwarder**, so the CRE transport is a **simulation
forwarder or an EOA relay**, and there is **no on-chain DON-signature verification** in this
build. Consequently, **whoever holds the relay key is a trusted "pay-any-pending-claim" oracle**:
they can force a full covered payout on any `ClaimPending` job. Recipients are job-bound (the payout
goes to the job's client, not an arbitrary address), so the relay cannot pay itself directly — but a
client colluding with the relay operator can extract a provider's collateral. This is acceptable
**only** for a hackathon demo. **Production requires a real `KeystoneForwarder` that verifies DON
signatures, or in-contract signature verification inside `onReport`** (see ADR-004). This trust
boundary is documented, not hidden, and is exercised by
`test_ForwarderIsEOA_CanForceCoveredPayout`.

## Post-review hardening (2026-09-10)

The multi-agent code review of PR #1 produced follow-up fixes that tighten this design (findings
tracked in `todos/`):

- **Config timelock (004).** `setForwarder`/`setExpectedWorkflow` were replaced by
  `queueForwarder`+`applyForwarder` and `queueExpectedWorkflow`+`applyExpectedWorkflow`, gated by a
  2-day `CONFIG_TIMELOCK`. A compromised admin can no longer *instantly* repoint the settlement gate
  to force a payout — the change is visible and delayed. (EOA-relay forwarders remain allowed for the
  hackathon per the B3 caveat above; the timelock is defense-in-depth, not a replacement for real
  DON-signature verification.)
- **Report domain binding (003).** The CRE report is now
  `abi.encode(uint256 chainId, address hub, uint256 jobId, bool covered, uint256 amount)`, and
  `onReport` reverts `ReportDomainMismatch` unless `chainId == block.chainid` and `hub == address(this)`.
  This blocks replay of a valid report across chains/deployments that share a workflow identity.
- **openClaim is non-pausable (001).** Opening a claim accesses already-earned coverage (no new
  liability) and is time-bounded by `coverageEnd`, so it joins the non-pausable exit set — a pause can
  no longer run out a client's window while the provider later withdraws.
- **Reputation honesty (007).** The subgraph now separates contested/timed-out windows
  (`Provider.contestedCompletions`, `Claim.resolvedByTimeout`, indexed `ClaimTimedOut`) from clean
  completions, so stonewalling the CRE until the timeout cannot read as a clean finish.
- **ABI single source enforced (002).** CI (`contracts.yml`) regenerates the shared + subgraph ABIs
  from the build and fails on drift.

## Consequences

- **Positive:** one canonical settlement contract with a clear, testable lifecycle; a clean split
  between the public evaluator and the confidential receiver; no admin path to principal; a machine-
  checked solvency invariant; and no state in which a party's funds can be trapped (every branch has
  a non-pausable exit, including the claim-timeout fallback).
- **Positive:** merging create+fund into `openJob` and pinning guarantee terms to the provider's
  acceptance keep the on-chain surface minimal and match the agent-quotes-terms story.
- **Negative / watch-outs:** the B3 forwarder trust caveat is the headline production gap — the
  hackathon build trusts the relay operator for claim finalization. The service fee is unprotected
  protocol revenue (admin may route it to itself), so "no admin can seize funds" is scoped to task
  fee + collateral only. The evaluator is a trusted liveness oracle, and the provider bears
  evaluator-liveness risk on `Submitted → Expired`; both argue for a multisig evaluator and, later,
  permissionless approval against the public criteria hash. The USDC pin (reject any non-canonical
  token) is what makes the `+= taskFee` accounting safe against fee-on-transfer tokens.
