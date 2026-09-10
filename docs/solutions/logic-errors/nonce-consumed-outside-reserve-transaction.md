---
title: "Nonce consumed in a separate transaction from the intent reserve → crash window strands the action"
category: logic-errors
tags: [idempotency, nonce, transaction, atomicity, crash-recovery, postgres, agent, payments]
module: apps/agent, packages/db
symptom: "After a crash (or a thrown error) between consuming a single-use nonce and creating the payment intent, a retry sees the nonce already used and returns a bogus 'ALREADY_POSTED' — but no intent exists and no payment ever happened, so the action can never complete for that quote."
root_cause: "The single-use nonce was consumed in its own committed transaction BEFORE the reserve/insert of the payment intent. The nonce burn and the intent creation were not atomic, so a failure between them leaves the nonce spent with nothing to show for it."
date: 2026-09-11
---

# Nonce consumed outside the reserve transaction

## Symptom

A quote's single-use nonce (`== quoteId`) is consumed to prevent double-posting a bond. But the two
steps ran separately:

```ts
const fresh = await store.consumeNonce(quoteId);   // commits on its own
if (!fresh) return { status: existing?.status ?? "ALREADY_POSTED" }; // existing is null after a crash
await payments.execute(...);                        // creates the PLANNED intent + sends
```

If the process dies (or `execute` throws) after `consumeNonce` commits but before the intent is
created, a retry hits `consumeNonce → false`, finds no intent, and reports `ALREADY_POSTED` — yet no
bond was ever posted, and the burned nonce means it never can be.

## Why it's subtle

Each step is individually correct and individually atomic. The gap is the **window between them**. It
only manifests on a crash/error in that window, so it passes happy-path tests and normal replays.

## Root cause

Two separate commits (`consumeNonce`'s tx, then the intent-insert tx) that must be all-or-nothing were
not wrapped in one transaction. Classic non-atomic "check-then-act across two writes."

## Solution

Fold the nonce consumption **into the same transaction** as the intent insert, and drop the separate
pre-consume + the magic-string branch. The deterministic idempotency key already dedupes replays.

```ts
// inside reserveIntent's prisma.$transaction, after the advisory lock + existing-check + cap:
if (nonce) {
  await tx.$executeRaw`
    INSERT INTO "UsedNonce" (nonce, "quoteId", "usedAt")
    VALUES (${nonce}, ${quoteId}, now())
    ON CONFLICT (nonce) DO NOTHING`;
}
await tx.paymentIntent.create({ data: { ...intent, status: "PLANNED" } }); // same tx → atomic
```

Now a crash rolls back *both* the nonce and the intent together; a retry re-runs cleanly. Replay
protection comes from (a) the deterministic `idempotencyKey` (same quote+action → same PK → the reserve
returns the existing intent) and (b) the on-chain `quoteId`-as-nonce slot in the escrow.

Related fixes made in the same pass: acquire the advisory lock BEFORE the existing-check (so concurrent
identical keys serialize instead of racing to a PK-conflict P2002), and assert a persisted `paramsHash`
on the existing-intent path (so a changed amount under a fixed key is refused, not silently deduped).

## Prevention

- Two writes that must be all-or-nothing belong in ONE transaction. A standalone `consumeX()` that
  commits before the work it guards is a crash-window smell.
- Prefer a single deterministic idempotency key + an atomic reserve over a separate "nonce gate" — fewer
  moving parts, no cross-write window.
- Never return a success-ish status (`ALREADY_POSTED`) from a branch that can be reached with no
  underlying record; if state is inconsistent, re-drive or fail loud.

## References

- Review todo `034` (PR #3), convergent across security + architecture + data-integrity. Fix `67714a6`.
