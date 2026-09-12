---
title: "A wallet transaction engine that 'looked right': six correctness bugs where documented intent didn't match behavior"
category: logic-errors
tags: [react, tanstack-query, react-query, wagmi, viem, state-machine, polling, refetchInterval, invalidateQueries, localStorage, useEffect, dApp, ui-correctness, code-review]
module: apps/web
symptom: "A transaction-flow engine + its TanStack Query read hooks pass typecheck/lint/build and look correct, but an independent review finds six defects where the code's own comments/rules don't match runtime behavior: (1) a status poll that never stops on error and loops forever; (2) a confirmed transaction that can flip to 'error'; (3) 'resume pending tx after refresh' persistence that is write-only; (4) a 'poll until state advances' hook that never polls; (5) a disabled-gate wired only to aria-disabled; (6) a sign-vs-simulate decision driven by the wrong signal."
severity: high
date: 2026-09-12
---

# Six "looks right, isn't" bugs in a wallet TX engine + TanStack read hooks

## Symptom

`apps/web`'s transaction engine (`lib/tx/engine.ts`) and read hooks (`lib/api/hooks.ts`) compiled, linted,
and built green, and each piece had a comment describing the correct intent. A multi-agent review found
the implementations quietly contradicted those comments. None were type errors; all were behavioral.

## Root cause + fix, per bug

### 1. A poll that never stops on error → unbounded request loop
`refetchInterval` stop-condition gated on `query.state.data`:
```ts
refetchInterval: (q) => (q.state.data && q.state.data.status !== "PENDING" ? false : 3_000)
```
On an **errored** fetch `data` is `undefined`, so it falls through to `3_000` forever — hammering a
already-failing endpoint (×`retry`). **Fix:** check error first.
```ts
refetchInterval: (q) => {
  if (q.state.status === "error") return false; // stop on error — never an unbounded loop
  return q.state.data && q.state.data.status !== "PENDING" ? false : 3_000;
}
```

### 2. `await invalidateQueries()` inside the try flips a confirmed tx to "error"
```ts
setFlow({ stage: "done", … });
await queryClient.invalidateQueries();   // inside try, unfiltered
// catch → setFlow({ stage: "error" })   // a rejected refetch lands here and OVERWRITES done
```
`invalidateQueries()` awaits the refetch of every active query; if any rejects (likely, given degradable
endpoints), the `catch` runs and clobbers the already-set terminal `done`. **Fix:** scope it to the
affected keys and make it **fire-and-forget, outside the await path**:
```ts
setFlow({ stage: "done", … });
void queryClient.invalidateQueries({ queryKey: keys.job(id) }); // not awaited → can't clobber `done`
```

### 3. "Resume after refresh" persistence that is write-only
The engine called `savePendingTx`/`clearPendingTx` and the module promised "refresh-survival", but
`loadPendingTx` was **never imported anywhere** (confirm with a grep) — nothing rehydrated on mount. A
built-but-disconnected abstraction is *worse* than none: it reads as done. **Fix (choose one, don't
ship the gap):** wire a mount `useEffect` that reads the blob and reconciles against chain/API
(`getTransactionReceipt` → re-run `trackTx` → `done`/`mismatch`; treat the persisted stage as a *hint*),
**or** delete the store and the claim.

### 4. "Poll until the state advances" that never polls
```ts
const job = useJob(id, flow.stage === "done" ? () => true : undefined);
// refetchInterval: (q) => (q.data && pollUntil(q.data) ? false : 2_000)
```
`pollUntil = () => true` makes the predicate return `false` (stop) on the first fetch — it never polls,
so a chain read that lags a just-mined tx shows stale state. **Fix:** capture the pre-action value and
poll until it genuinely changes: `pollUntil = (j) => j.status !== statusAtActionStart.current`.

### 5. A disabled-gate wired only to `aria-disabled`
```tsx
<button disabled={!available || busy} aria-disabled={blocked /* includes !commitmentValid */}>
```
The real `disabled` attribute (and the pointer-events class) omitted `commitmentValid`, so the control
still fired with empty input → a server 400. **Fix:** use the full `blocked` expression for `disabled`
and the class too, not just `aria-disabled`.

### 6. Sign-vs-simulate decided by the wrong signal
"Do a real transaction vs a labeled simulation" was `simulate = !mode.arc`, where `mode` came from an
**API health probe** that resolves null on a transient 401/503. A session/health blip would silently
downgrade a real, wallet-backed action to a no-op simulation. **Fix:** derive it from **wallet reality**
(connected wallet + correct chain), and put it behind a transport seam so the branch lives in one place,
not scattered `if (simulate)` checks.

## Cross-cutting lesson

Each bug is an **intent/behavior gap**: the comment said X, the code did Y, and the type system + a green
build couldn't catch any of them because they're about *runtime control flow*, not types. Two recurring
shapes to watch for:

- **Stop/terminal conditions gated on the happy-path field** (`data`, a specific status) that never fire
  on the error/edge branch → unbounded loops or stuck spinners. Always handle `status === "error"` and a
  timeout explicitly.
- **Awaiting side effects inside a `try` after you've already set a terminal success state** → a later
  rejection rewrites success as failure. Set the terminal state, then fire side effects outside the
  catch's reach.

## Prevention

- Model multi-step flows as an **explicit discriminated union** (not a TanStack `useMutation`, whose
  `idle|pending|success|error` can't represent the stages) so "no success before receipt" is a
  compile-time property — but know the union doesn't catch the *control-flow* bugs above; review those.
- When a comment claims a guarantee ("survives refresh", "polls until…"), **grep for the consumer** that
  delivers it. A writer with no reader is a red flag.
- Gate interactive controls on the **real** `disabled`, never only `aria-disabled`.
- Base "can we do the real thing?" on the **authoritative local signal** (wallet/chain), not a remote
  health probe that can fail transiently.

## Related

- [[nextjs16-wagmi-rainbowkit-ssr-wiring]] — the wallet layer this engine sits on.
- PR #6 review + resolution: `docs/reviews/2026-09-12-pr6-outcome-assurance-web-review-resolution.md`
  (findings P2-1..P2-9); fixes in `apps/web/lib/tx/{engine,transport,persistence}.ts`,
  `apps/web/lib/api/hooks.ts`, `apps/web/components/jobs/JobDetail.tsx`.
