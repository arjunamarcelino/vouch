# ADR-006 — Risk features as BigInt basis points in the subgraph; consumers fail closed

**Status:** Accepted

## Context

The risk agent sizes on-chain USDC guarantees from provider performance history that lives **only** in
The Graph (ADR-003). Two things had to be true for that to be trustworthy: (1) the math must be exact
and reproducible (no floating point, which forks Proof-of-Indexing and loses precision on 6-decimal
USDC counters that exceed 2^53), and (2) the agent must never quote off missing or stale data.

The prior implementation computed ratios with JavaScript `Number()` in the agent (a precision bug) and
guarded only on `hasIndexingErrors` (fail-open on lag/unavailability). The consumer schema had also
drifted — it queried a `regressions` field that did not exist.

## Decision

1. **Cumulative risk features are computed in the subgraph as integer basis points** (`BigInt`,
   multiply-before-divide, `isZero()` → `-1` sentinel). A mutable `Provider` holds raw counters + the
   last-materialized bps (an in-memory diff source); an immutable `ProviderRiskSnapshot`
   (`provider ++ txHash ++ logIndex`) is appended on change. Windowed `recentFailureRateBps` is
   computed read-time as `BigInt` over a manual per-day `ProviderDailyMetric` bucket (native
   `@aggregation` was rejected — Matchstick 0.6.0 cannot test it and crashes on `Timestamp!`, #433).
   The finding-007 clean-vs-contested completion split is preserved so a stonewalled/timeout close can
   never read as a clean success.

2. **Consumers fail closed.** A shared gate in `@vouch/shared/graph` asserts freshness before any
   money-relevant read: it throws `SUBGRAPH_UNAVAILABLE`/`STALE`/`LAGGING` on transport failure,
   indexing errors, a deployment-id mismatch, or block-lag over budget (or uncomputable because the
   RPC head is unreadable — RPC is therefore a **required** quoting dependency). The agent models the
   result as a discriminated union (`features` | `new-provider`); the API maps `SUBGRAPH_*` → HTTP 503.
   A genuinely new provider (fresh index, no history) gets a documented conservative quote; "blind"
   (stale/unavailable) is always a refusal — never fabricated history.

## Consequences

- **Positive:** the whole pipeline (subgraph → features → quote) is integer-exact and reproducible
  from `asOfBlock` + `scoringFnVersion`; The Graph is genuinely load-bearing; no fabricated-history
  path exists. Fixes the `regressions` drift and the `Number()` precision bug.
- **Negative / watch-outs:** RPC coupling — the quote path now depends on the subgraph AND the RPC
  agreeing; RPC-down = refuse (accepted: fail-closed beats fail-open for guarantee sizing).
  `recentFailureRateBps` needs a real time horizon, so it reads ~0 over a minutes-long demo (called out
  in `docs/the-graph-demo.md`). A breaking schema rename requires a full resync (new deployment ID) and
  an atomic consumer cutover.
- **Accepted risk:** an optional `DEGRADED` band (off by default) would allow a quote from a slightly
  lagging index; if ever enabled it must forbid `recentFailureRateBps` and cap at the base cap.
