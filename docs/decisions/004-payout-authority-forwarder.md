# ADR-004 — Payout authority = onchain DON-signature verification

**Status:** Accepted (**revised** per plan §17.3 — supersedes the earlier "trust the forwarder
sender" formulation)

## Context

The guarantee payout moves real money on Arc. It must fire **only** when the confidential CRE
workflow proves a covered regression — and never because some other actor (including our own
agent) decided it should. The original design gated the payout on `msg.sender` being the
**KeystoneForwarder**. Two adversarial reviewers independently found the flaw:

- Arc testnet may not expose a canonical KeystoneForwarder, forcing a **relay fallback** where an
  agent submits the verdict to Arc.
- If `onReport` merely trusts `msg.sender`, that relay agent becomes a **unilateral payout oracle**
  — it could forge a payout. That is **agent-as-authority**, which Vouch forbids.

## Decision

**Trust the DON signature, verified onchain — not the caller.** The receiver verifies the **CRE
DON signature** against known DON keys *onchain*, then transport is untrusted:

- **agent-as-transport (ALLOWED):** an agent (or any relay) may carry the signed report bytes to
  Arc. It cannot forge a valid DON signature, so it cannot forge a payout.
- **agent-as-authority (FORBIDDEN):** no actor may move guarantee funds without a valid DON-signed
  verdict. The agent quotes and monitors; it never settles.

The receiver is also **bound to the expected workflow** (`expectedWorkflowId` / `expectedAuthor` /
`expectedWorkflowName`) so a *different* workflow sharing the same forwarder cannot settle Vouch
jobs. Contract test **E8b** covers "valid forwarder, wrong workflow → revert".

**Open question — KeystoneForwarder vs self-verifier:** if Arc has a canonical KeystoneForwarder,
use `ReceiverTemplate` (forwarder-gating). If not, deploy a **minimal onchain signature verifier**
on Arc that checks the DON signature set, and let an untrusted relay deliver only the bytes. Either
way, "money moves only on a DON-signed report" holds on Arc regardless of Forwarder availability,
preserving ADR-001 (Arc owns financial state).

If onchain signature verification proves infeasible within the hackathon window, the relay path
must be gated behind a **client dispute window + timelock** and labeled explicitly
"trusted-relay, NOT trust-minimized" so judges are not misled. This is a **Phase-0/Phase-1 gating
decision** because it defines the receiver's trust surface and the E8/E8b tests.

## Consequences

- **Positive:** removes the unilateral-oracle vulnerability (reviewer BLOCKER B1) and the
  wrong-workflow vulnerability (B2). The relay fallback becomes safe because transport is
  untrusted.
- **Positive:** decouples payout security from whether Arc ships a KeystoneForwarder.
- **Negative / watch-outs:** onchain DON-signature verification is more implementation work than
  gating on `msg.sender`; the DON key set and (if used) the KeystoneForwarder / verifier addresses
  must be resolved at build time. `ReceiverTemplate` is already `Ownable` — resolve the single
  `Ownable` lineage deliberately when adding admin setters for the expected-workflow bindings.
