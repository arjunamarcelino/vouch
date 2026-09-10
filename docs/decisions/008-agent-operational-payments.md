# ADR-008 — Agent operational payments (the quote bond)

**Status:** Accepted (2026-09-11)

## Context

Arc's "Best Agentic Economy Application with the Circle Agent Stack" prize requires the agent to
perform a **real USDC action on Arc**, not merely recommend a price. But Vouch's core invariant
(ADR-004/005) is that the agent is **transport, never authority** over guarantee principal: the
100-USDC guarantee payout moves **only** on a DON-signed CRE verdict via `AssuranceHub.onReport`.

An earlier design considered having the agent pay the **assurance service fee** to `feeRecipient`. A
multi-agent review (security + architecture) found this **collides with ADR-005 §4** — the *client*
already escrows that fee via `openJob`, disbursed to `feeRecipient` at `resolveInitialEvaluation` — so
an agent-paid fee would **double-pay** `feeRecipient` and reframe the agent as *payer* of protocol
revenue rather than *transport*. That option was **dropped**.

## Decision

The agent's real USDC action is a **refundable quote bond** it posts from its own policy-capped,
minimal-balance wallet — its **own capital at stake** per quote, held in `QuoteBondEscrow`:

- `postBond(quoteId, amount, expiresAt)` — agent → escrow, when it issues a signed quote.
- `refundBond(quoteId)` — escrow → **recorded poster**, permissionless after expiry (quote lapsed).
- `releaseBond(quoteId)` — escrow → poster, `PROTOCOL_ROLE`, when a job honors the quote.
- `consumeBond(quoteId)` — escrow → `slashSink`, `PROTOCOL_ROLE`, optional slashing of a proven-bad
  quote. Never `feeRecipient`, never principal.

This is **self-custody / agent-as-transport** of operational capital. It **does not touch guarantee
principal or the payout path**, so ADR-004/005's invariants are untouched. The `assuranceServiceFee`
remains a **computed advisory field** of the quote (what the client will escrow) — the agent never
transfers it.

Safety: deterministic UUIDv5 idempotency key + persisted `PaymentIntent` state machine (exactly-once),
`paramsHash` stale-amount guard, per-wallet atomic daily-cap reserve, destination allowlist, chain/
contract preflight, crash reconciliation.

## Consequences

- **Positive:** satisfies the prize with a genuine, autonomous on-chain USDC action while preserving
  the "no agent authority over principal" invariant; no ADR-005 fee double-pay; the bond is refundable,
  so it is not a sunk cost.
- **Wording correction:** the agent README / `prize-requirements.md` "never moves funds" becomes "never
  moves **guarantee principal / payout**" — holding and refunding its **own** bond is permitted.
- **Negative / watch-outs:** the prize-qualifying action ships as a Circle DCW transfer to the bond
  destination; wiring `QuoteBondEscrow.postBond` via Circle **contract-execution** (approve + call) is
  the trust-minimized upgrade (tracked in `docs/arc-agent-stack.md`). The on-chain `JobCreated` event
  carries no `quoteId`, so autonomous release relies on an off-chain quote↔job match.
