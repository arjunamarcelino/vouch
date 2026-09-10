---
title: "\"Rolling daily cap\" was silently a non-resetting lifetime cap (missing time window on the SUM)"
category: logic-errors
tags: [postgres, prisma, spend-cap, aggregation, agent, payments, sql]
module: packages/db, apps/agent
symptom: "After cumulative confirmed spend approaches AGENT_DAILY_CAP, ALL further payments are rejected with DAILY_CAP_EXCEEDED and never recover — the cap never resets, despite being documented as 'rolling daily'."
root_cause: "The reserve SUM aggregated all non-terminal intents (which includes every historical CONFIRMED) with no createdAt time filter, so the total only ever grows. A 'daily' cap with no time window is a lifetime cap."
date: 2026-09-11
---

# "Rolling daily cap" was actually a lifetime cap

## Symptom

The agent's spend cap is described (in code comments + schema) as a rolling daily limit. In practice,
once the sum of all successful bonds nears `AGENT_DAILY_CAP`, every new payment fails
`DAILY_CAP_EXCEEDED` permanently — the cap never rolls over at day boundaries.

## Why it's subtle

Low-volume demos never approach the cap, so it looks fine. The bug is invisible until cumulative
lifetime spend (not daily spend) crosses the threshold — potentially long after ship. Counting
in-flight/`CONFIRMED` intents is *correct* (so concurrent retries can't breach the cap); the omission
is purely the **time window**.

## Root cause

```sql
-- WRONG: no time filter → sums every CONFIRMED intent for all time → monotonically increasing.
SELECT COALESCE(SUM(amount::numeric), 0) FROM "PaymentIntent"
WHERE status NOT IN ('FAILED', 'ABANDONED');
```

`CONFIRMED` is (correctly) a non-terminal state for the cap, but with no `createdAt` bound the total is
cumulative-forever.

## Solution

```sql
-- Add a rolling window (or a UTC-day boundary via date_trunc('day', now())).
SELECT COALESCE(SUM(amount::numeric), 0) FROM "PaymentIntent"
WHERE status NOT IN ('FAILED', 'ABANDONED')
  AND "createdAt" >= now() - interval '24 hours';
```

- Back the windowed scan with a partial index on the time column:
  `CREATE INDEX ... ON "PaymentIntent" ("createdAt") WHERE status NOT IN ('FAILED','ABANDONED');`
- Make the code comment and the schema comment agree with the actual predicate.
- Note the scope: this SUM is unscoped by wallet (safe only under a single-agent-wallet assumption — the
  per-wallet advisory lock enforces that). Add a wallet/token filter if multi-wallet is introduced.

## Prevention

- Any "per day / per hour / rate" limit expressed as an aggregate MUST carry a time predicate. When you
  see `SUM(...) WHERE status ...` with no `createdAt`/window, treat it as a lifetime total.
- Write a test that inserts an old CONFIRMED row (outside the window) and asserts it does NOT count.
- Make the doc-comment claim ("rolling daily") and the query verifiable against each other in review.

## References

- Review todo `033` (PR #3), convergent across security + performance + data-integrity. Fix `8fe36ca`.
- Related: `034` (atomic reserve + cap-race), `036` (constraints/index applied via db:constraints).
