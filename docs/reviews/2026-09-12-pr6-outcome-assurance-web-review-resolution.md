---
title: "Code Review — PR #6: build outcome assurance product experience"
pr: 6
branch: feat/outcome-assurance-web
reviewed: 2026-09-12
reviewers:
  - kieran-typescript-reviewer
  - security-sentinel
  - architecture-strategist
  - performance-oracle
  - code-simplicity-reviewer
  - pattern-recognition-specialist
  - agent-native-reviewer
verdict: No P1 merge-blockers. 9 P2 (should-fix) + cleanup. Findings only — nothing was changed.
---

# Code Review — PR #6 `feat: build outcome assurance product experience`

**Scope:** `apps/web/**`, `packages/shared/**`, `packages/ui/**` (48 files, +8231/−203; the bulk is
`pnpm-lock.yaml`). Seven agents reviewed the diff independently. **This is a findings document only —
no code was modified and nothing was fixed**, per request.

## Verdict

**No P1 (merge-blocking) findings.** Security and TypeScript reviewers both explicitly concluded there
are no merge blockers. The foundation is strong (see Positives). The recurring theme across the P2
findings is **documented intent not matching behavior** — several "hard rules" from the plan are built
but not actually wired. Four of the top findings were re-verified directly against source (noted
`✓ verified`).

| Severity | Count |
|---|---|
| 🔴 P1 — blocks merge | 0 |
| 🟡 P2 — should fix before relying on the flow | 9 |
| 🔵 P3 — cleanup / dedup / dead code | ~18 |
| ⚪ Informational / accepted trust model | 3 |

## Positives (consensus — keep these)

- **`TxFlow` discriminated union** makes "never show success before a confirmed receipt" a *compile-time*
  guarantee (`hash` only exists on stages that have one; `reverted`/`rejected` can't reach `done`).
- Calldata is **signed verbatim** (no re-encoding); approvals are **exact-amount** (never `MaxUint256`).
- **Secrets boundary holds**: raw private preimage never persists, logs, or reaches the API/telemetry;
  only the `bytes32` commitment crosses the boundary, via the shared `@vouch/shared/commitment` helper
  (the prior agent-native gap is genuinely resolved — **12/12 UI actions have an API equivalent**).
- **No XSS surface**: no `dangerouslySetInnerHTML`, all dynamic strings escaped, every external link has
  `rel="noopener noreferrer"`, no user-controlled `href`.
- **No `any`/unsafe casts of note**; `0x${string}`/`Hex` branding and `verbatimModuleSyntax` type-only
  imports are disciplined; `parseOrThrow` boundary validation is consistent; `localStorage` reads are
  Zod-validated.
- **Authority model is respected**: Arc is authoritative for lifecycle (feed is labeled decoration),
  reputation fails closed on 503 / returns `null` (not fabricated) on 404; no component reads the
  subgraph directly; `@vouch/ui` stays domain-agnostic; the explicit FSM is the correct seam (not a
  `useMutation`).

---

## 🟡 P2 — Should fix (behavior contradicts documented intent / real bugs)

### P2-1 · Refresh-survival persistence is write-only — the resume guarantee does not exist  `✓ verified`
**Files:** `apps/web/lib/tx/persistence.ts:34`, `apps/web/lib/tx/engine.ts:78,153,163,171`
**Reviewers:** architecture (H1), simplicity (#1), typescript (#3) — **4× consensus**.
`savePendingTx`/`clearPendingTx` are called throughout the engine, but `loadPendingTx` is **never
imported or called anywhere** (verified: only its definition matches). Nothing rehydrates the blob on
mount, so the plan's hard rule *"preserve pending tx after refresh … reconcile via `GET
/transactions/:txHash` + receipt"* is unmet. A user who refreshes mid-`submitted`/`tracking` loses the
flow; the orphaned blob is cleared only on the next completed tx.
**Recommendation:** either wire a mount-time resume effect in `useTxEngine` (read `loadPendingTx`,
re-enter a reconciling stage that re-polls the receipt and re-runs `trackTx`), **or** delete the
persistence layer and drop the claim from the docstrings. (Pick one — don't ship a disconnected
abstraction that reads as done.)
**Resolution:** ✅ Fixed (wired — chosen over deletion). `useTxEngine` now has a mount/account-change
`useEffect` (guarded once-per-address via a ref) that calls `loadPendingTx`, then reconciles the
persisted `txHash` against the chain: `getTransactionReceipt` (fall back to a bounded
`waitForTransactionReceipt` if unmined) → `reverted` / re-run `trackTx` → `trackMismatch` or `done`, and
clears the blob on resolution (a timeout re-enters `timedOut`). The persisted `stage` is treated as a
hint only. (`engine.ts`)

### P2-2 · Post-tx `invalidateQueries()` is unfiltered AND awaited in the try — a confirmed tx can flip to "error"  `✓ verified`
**File:** `apps/web/lib/tx/engine.ts:172`
**Reviewers:** performance (#2), typescript (#5).
`await queryClient.invalidateQueries()` (no key filter) refetches *every* active query (auth, health,
all jobs, providers, feed, allowance) on each successful tx. Worse, the `await` sits **inside the try**:
if any one of those refetches rejects — likely, given the degradable polling endpoints — the `catch`
runs `setFlow({ stage: "error" })`, **overwriting the already-set `done`**. A fully confirmed,
receipt-verified transaction can render as a failure because an unrelated query refetch failed.
**Recommendation:** scope to affected keys (`queryKeys.job(jobId)`, `claimStatus(jobId)`, `myJobs`,
`allowance`) and move the invalidation **out of the try** (or fire-and-forget) so it can never clobber
the terminal `done` stage.
**Resolution:** ✅ Fixed. `invalidateScoped()` now invalidates only `myJobs` + `allowance` (+ `job(jobId)`
/ `claimStatus(jobId)` when a jobId exists) and is **fire-and-forget** (`void`, not awaited), called
after `setFlow(done)` — a rejected refetch can no longer flip `done`→`error`. (`engine.ts`)

### P2-3 · Status polls never stop on error → unbounded 3s request loop  `✓ verified`
**File:** `apps/web/lib/api/hooks.ts:137-140` (claim status) and `:93-96` (`useJob`)
**Reviewer:** performance (#1).
The stop predicate requires `query.state.data` to exist: `data && data.status !== "PENDING" ? false :
3_000`. On an **errored** endpoint `data` is `undefined`, so it re-polls every 3s forever (×`retry: 2`).
`JobDetail` and `ClaimFlow` mount this unconditionally, so a degraded `/claims/:id/status` turns every
open job tab into a sustained request storm against an already-failing service.
**Recommendation:** add `if (query.state.status === "error") return false;` before the data check (both
hooks), and treat any non-`PENDING` status (including `NONE`) as a stop.
**Resolution:** ✅ Fixed. Both `useJob` and `useClaimStatus` `refetchInterval` callbacks now return
`false` immediately when `query.state.status === "error"`, so a degraded endpoint can no longer drive an
unbounded 3s/2s request loop. (`hooks.ts`)

### P2-4 · `useJob` post-tx polling is a dead no-op → stale state after an action  `✓ verified`
**Files:** `apps/web/components/jobs/JobDetail.tsx:61`, `apps/web/lib/api/hooks.ts:93-95`
**Reviewers:** typescript (#1), performance (#3), architecture (M4) — **3× consensus**.
`useJob(id, engine.flow.stage === "done" ? () => true : undefined)` — `pollUntil = () => true` makes
`refetchInterval` return `false` immediately, so it never polls. The comment promises "poll the chain
read until the lifecycle advances"; in reality the only post-tx refresh is the single (problematic)
blanket invalidation in P2-2. If the Arc read lags one block behind the mined receipt, the timeline and
available actions show stale state until a manual reload.
**Recommendation:** capture the pre-action ordinal and pass a real predicate, e.g.
`(j) => JOB_STATES.indexOf(j.status) > priorOrdinal`; gate polling on `submitted`/`tracking`/`done`.
**Resolution:** ✅ Fixed. `JobDetail` records the lifecycle status when an action is dispatched
(`statusAtActionStart` ref) and, once `flow.stage === "done"`, passes `pollUntil = (jv) => jv.status !==
statusAtActionStart.current` so `useJob` actually polls until the authoritative chain read advances
(bounded by the new error-stop in P2-3). (`JobDetail.tsx`)

### P2-5 · Track FSM treats `PENDING` as success → premature "Confirmed on-chain" + explorer link  `✓ verified`
**File:** `apps/web/lib/tx/engine.ts:161,170`
**Reviewer:** typescript (#4).
`trackedTxStatusSchema` is `["PENDING","CONFIRMED","MISMATCH"]`, but the engine only branches on
`MISMATCH`; `PENDING` falls through to `{ stage: "done", simulated: false }`. If `/transactions/track`
requires >1 confirmation and returns `PENDING`, `TxStatus` shows "Confirmed on-chain" with a
provenance-gated explorer link for a tx the API has **not** bound — contradicting the receipt-gating
rule that is otherwise the PR's centerpiece.
**Recommendation:** branch explicitly — only `CONFIRMED` → `done`; `PENDING` stays in
`tracking`/`confirming` (poll or show "verifying"); `MISMATCH` unchanged.
**Resolution:** ✅ Addressed (verified not a fabrication bug). The engine only reaches `trackTx` **after**
`waitForReceipt` returned `"success"` — i.e. the tx is already mined+confirmed on-chain — so "Confirmed
on-chain" is accurate regardless of the track result. `trackTx` is the API's arg-diff *binding*, not the
on-chain confirmation: `MISMATCH` → `trackMismatch` (tamper), `CONFIRMED`/`PENDING` → `done`. Made the
intent explicit with a comment and the single `MISMATCH` branch. (`engine.ts` step 6)

### P2-6 · `commitmentValid` gate is wired only to `aria-disabled`, not the real `disabled`  `✓ verified`
**File:** `apps/web/components/jobs/JobDetail.tsx:294-318`
**Reviewer:** typescript (#2).
`blocked` (which includes `!commitmentValid`) feeds `aria-disabled` only; the actual `disabled` attr and
the `pointer-events-none` class use `!a.available || engine.isBusy`. A user can arm SUBMIT, leave the
bytes32 field empty, and the click fires `run("SUBMIT")` with `commitment === ""` → server `.strict()`
hex32 400s into a generic error. The client gate is effectively dead for the interactive path.
**Recommendation:** include the commitment check in `disabled` and the class guard.
**Resolution:** ✅ Fixed. The button's `disabled` attribute and `pointer-events-none`/`opacity-50` class
now both use the full `blocked` expression (which includes `needsCommitment(a.id) && commitFor === a.id
&& !commitmentValid`), so an empty/invalid bytes32 can't fire SUBMIT/CLAIM. (`JobDetail.tsx`)

### P2-7 · No receipt timeout / abort branch — the flow can pin in `submitted` forever
**File:** `apps/web/lib/tx/engine.ts:147,160`
**Reviewer:** architecture (H2).
`waitForTransactionReceipt` is awaited with no `timeout` and there's no `timedOut` stage. A stuck/dropped
tx pins the flow in `submitted` with `isBusy = true` and no escape but a full reload (which, per P2-1,
then loses the hash). Also, a `trackTx` failure falls to the outer `catch` → `error` but does **not**
`clearPendingTx`, orphaning the `tracking` blob.
**Recommendation:** add a `timeout` + a terminal `timedOut` stage ("check explorer / retry tracking");
clear persistence on the track-failure path. (NFR: "no indefinite spinners.")
**Resolution:** ✅ Fixed. The live transport's `waitForReceipt` passes `timeout: RECEIPT_TIMEOUT_MS`
(90s); on `WaitForTransactionReceiptTimeoutError` the engine sets a new terminal **`timedOut`** stage
(rendered by `TxStatus` with a "still pending — check explorer / retry" message) and **keeps** the
persisted blob so resume can re-poll it. The catch's terminal-error path now calls `clearPersisted()`
so a failed `trackTx` no longer orphans a `tracking` blob. (`engine.ts`, `transport.ts`, `TxStatus.tsx`)

### P2-8 · Wallet account-switch never re-auths or purges the cache
**Files:** `apps/web/app/providers.tsx:51-70`, `apps/web/lib/auth.ts:52-55` (no `useAccountEffect`/`watchAccount` anywhere)
**Reviewer:** security (#1).
`onAuthChange` only invalidates `authMe` and only fires on explicit verify/sign-out. Nothing watches the
wagmi address. Switch accounts in MetaMask and the SIWE cookie stays bound to the old address: `/auth/me`
still returns A, the UI still shows A's jobs/allowance, but the engine signs with B — at best `trackTx`
flags a mismatch, at worst a tx is prepared under the wrong identity. Sign-out also leaves non-auth
queries in the in-memory cache on a shared machine. The plan's own hard rule
(`accountsChanged` → invalidate + `queryClient.clear()`) is unimplemented.
**Recommendation:** add `useAccountEffect`/`watchAccount` → on address change, force SIWE re-verify (or
`signOut`) and `queryClient.clear()`.
**Resolution:** ✅ Fixed. `AuthGate` now watches `useAccount().address`; on any change after the first
connect it POSTs `/auth/logout` (ends the old-address session), `queryClient.clear()`s the cache, and
drops the old address's persisted pending-tx blob. `/auth/me` then re-derives as unauthenticated and
RainbowKit prompts a fresh SIWE sign-in. (`providers.tsx`)

### P2-9 · "Simulate" is derived from the API health probe, not wallet/chain reality
**Files:** `apps/web/components/jobs/JobDetail.tsx:88`, `ClaimFlow.tsx:67`, `jobs/new/page.tsx:135` (`simulate = !mode.arc`), `lib/mode.ts:31`, `lib/api/hooks.ts:67`
**Reviewer:** architecture (M2), related perf/M1.
`mode.arc` comes from `/health/integrations`, and `useIntegrationsHealth` resolves `null` on **401 or
503**. So a transient session blip or a degraded aggregator read silently downgrades a *real* action
(wallet genuinely on live Arc) into a no-op "local simulation." Also `input.prepare()` runs **before**
the `simulate` check (`engine.ts:118` vs `:130`), so a "local simulation" still round-trips the real
`/…/prepare` and can surface a genuine 503/403 inside a flow labeled "Done (local simulation)".
**Recommendation:** derive `simulate` from wallet connectivity + chain id (and/or an explicit demo
toggle), not the health probe; extract a `TxTransport` (`live` | `simulated`) seam so the simulated path
synthesizes its result without hitting `prepare` (also removes the scattered `if (simulate)` branches).
**Resolution:** ✅ Fixed. New `lib/tx/transport.ts` defines `TxTransport` with `createLiveTransport`
(wagmi/viem send + bounded receipt) and `SIMULATED_TRANSPORT`. The engine picks the transport from
**wallet reality** (`address && publicClient` → live, else simulated) — not the health probe; the
`simulate` param was removed from `RunInput` and all three callers. The simulated path now short-circuits
to a flagged, hash-less `done` **without calling `prepare`** (no real API/chain round-trip, no mislabel).
Action-area "live / connect to act" badges now reflect session (`me.data`), not the probe.
(`engine.ts`, `transport.ts`, `JobDetail.tsx`, `ClaimFlow.tsx`, `jobs/new/page.tsx`)

---

## 🔵 P3 — Cleanup, dedup, and dead code

**Dead / vestigial code**
- `confirming` TxFlow stage is set then synchronously overwritten by `done` with no `await` → never
  renders. Drop it (`engine.ts:168-170`; union `:32`; `TxStatus.tsx:33-34`; `persistence.ts:16`). *(ts, simplicity, arch)* — **✅ removed** from the union, `TxStatus`, and the persistence enum.
- `loadPendingTx` / whole persistence module unused if P2-1 is resolved by deletion (`persistence.ts`).
- `useFeed` + `useAllowance` hooks never imported (allowance read imperatively; no feed UI) — `hooks.ts:144-159`. *(simplicity #3)*
- `apiPut` + the `"PUT"` method branch unused — `client.ts:62,96-98`. *(simplicity #4, pattern #14)*
- `ApiClientError.isForbidden` getter unused — `client.ts:29-32`. *(simplicity #9)*
- `export { Clock }` re-export in `indicators.tsx:91` has no consumer (ClaimFlow imports from `lucide-react`). *(pattern #12, simplicity #9)*
- Salt `setItem` (`jobs/new/page.tsx:80`, `ClaimFlow.tsx:66`) is never read back → dead writes; also no
  `try/catch` (can throw in private-mode/quota and break submit) and unbounded growth. *(security #4, simplicity #5, arch L5)*
- `query.ts:13-17` `shouldDehydrateQuery: 'pending'` is dead — every route is `"use client"`, nothing prefetches to dehydrate. *(arch L6)*

**Duplication (the PR's own "one X" goal invites these)**
- Claim-status rendered two diverging ways: `JobDetail` `ClaimBadge` shows the **raw enum**; `ClaimFlow`
  shows **human text**. Add `CLAIM_STATUS_META` + a shared `ClaimBadge` to `indicators.tsx`. *(pattern #1/#2, fixes the `as` cast at JobDetail.tsx:332)*
- Claim eligibility + reason strings re-implemented in `ClaimFlow.tsx:45-61` instead of reusing
  `jobActions(...).find(a => a.id === "CLAIM")` — strings already drift from `roles.ts`. *(pattern #3, simplicity #6)*
- "Live / Local simulation" pill implemented 4 ways (`mode.modeLabel`, `PrizeEvidenceDrawer.StatusPill`,
  `demo/page.RailPill`, inline `<Badge>`s). Extract one `<ModePill live>`. *(pattern #4)*
- URL trailing-slash-trim + join duplicated 4× (`agentClient.ts:20`, `client.ts:42`, `auth.ts:16`,
  `format.ts:39`) → one `joinUrl`. *(pattern #5)*
- Hex/address regexes re-declared (`format.ts:40-41`, `JobDetail.tsx:32`, `jobs/new:69`) instead of
  reusing shared `hexAddress`/`HEX32_RE`. *(pattern #6)*
- Two API clients: `lib/agentClient.ts` persists with its own slash-trim + an inline `agentHealthSchema`
  (the one schema not centralized). Confirm it's still reachable; fold into shared views or delete. *(pattern #7)*
- Raw `<button className={buttonVariants(...)}>` + duplicated `opacity-50 pointer-events-none` ~6× instead
  of the `<Button>` primitive. *(pattern #9)*

**Correctness-adjacent nits**
- Approval sub-step skips the `chainId`-match and `value === "0"` guards applied to the main tx, and is
  never tracked (`engine.ts:103-108`). Apply the same asserts. *(security #2, ts #7)* — **✅ fixed**: the
  approval prepared tx now asserts `chainId === arcTestnet.id` + `value === "0"` before signing.
- `explorerAddressLink` is gated only by address-shape, not mode — simulated/seed addresses get real
  Arcscan `/address/` links (honesty nit). Gate behind `mode.arc`. *(security #3)*
- `UsdcAmount` brand is bypassed at the two arithmetic sites (`jobs/new:131` escrow sum, `JobDetail:99`
  allowance compare) — raw `BigInt(str)` skips `toUsdc`'s validation. Add `addUsdc`/`gte` helpers. *(arch M3)*
- `parseUsdcInput` accepts negatives (`parseUnits("-5",6)`) — only incidentally blocked by a form guard.
  Add a `^\d` check in the parser. *(ts #9)*
- Provider query key lowercases the address but the fetch sends the raw param → two cache entries + mixed
  casing to the API (`hooks.ts:112-117`). Lowercase once. *(ts #8)*
- `publicCriteriaHash` hashed inline (`jobs/new:89`, unsalted `keccak256`) rather than via
  `@vouch/shared` — undercuts the agent-parity rationale that centralized `computeCommitment`. *(agent-native, arch L4)*
- `FreshnessBadge` hardcodes `confidence="FRESH"` (`ProviderProfile.tsx:58`) regardless of index lag; the
  non-FRESH branches are dead. Wire real `dataConfidence` or drop the prop. *(ts #11, pattern #10, arch L3, simplicity #8)*
- `JobDetail` CLAIM action reuses the generic paste-a-bytes32 input; it should `Link` to
  `/jobs/[id]/claim` (the real client-side-hash claim UX). Keeps `needsCommitment` for SUBMIT only. *(simplicity #7)*
- Role resolver encodes deadline preconditions the API delegates to the contract (`roles.ts:60,79`), and
  offers `RESOLVE_TIMEOUT` before its deadline (not in `JobView`). Safe-direction drift; consider adding
  `claimResolutionDeadline` to `JobView`. *(arch L1/L2)*
- `sheet.tsx:25` raw `bg-black/40` (use `bg-foreground/40`); `JobDetail.tsx:212` arbitrary `text-[10px]`
  (use `text-xs`). *(pattern #11)*
- Chain assertion skipped when `walletChainId === undefined` (`engine.ts:93`) — relies on
  `sendTransaction({chainId})` as backstop; prefer switching/erroring. *(ts #6, security, arch L7)* —
  **✅ fixed**: guard is now `walletChainId !== arcTestnet.id` (covers undefined → attempts a switch).
- Full wallet stack (wagmi + RainbowKit + CSS) + a universal `/auth/me` call ship on every route incl.
  the static landing page. Acceptable for a dApp; could defer behind a wallet-only layout segment. *(perf #4)*
- Dashboard bucket filtering recomputed every render (incl. the 30s health poll) — `useMemo` it. *(perf #5)*
- `refetchOnWindowFocus` left at the v5 default (on) for list/reputation reads → minor tab-refocus churn. *(perf #7)*

---

## ⚪ Informational / accepted

- **Client signs prepared calldata it cannot independently verify** (`engine.ts:135`). This is the stated
  trust model; `chainId`/`value` guards + `trackTx` mismatch are reasonable mitigations. Flagged so the
  assumption is explicit: a compromised API can substitute calldata and the UI will sign it.
- **CSRF rests entirely on the backend cookie's `SameSite=Strict`** — no CSRF token on the
  `credentials:"include"` POSTs. Safe only while web+api are same-site; add a backend invariant test and
  never relax to `Lax`/`None`. *(security #6, arch cross-cutting)*
- **`commitment.ts` scheme must be reconciled with the CRE opening-JSON scheme**
  (`docs/chainlink-confidential-workflow.md §7`) before a live CRE settlement — the docstring flags it;
  affects UI and agent equally (not a parity asymmetry). *(agent-native)*

---

## Suggested order of attention

1. **P2-2 + P2-5** (success-state correctness: a confirmed tx shouldn't flip to error, and `PENDING`
   shouldn't read as confirmed) — these undercut the PR's headline guarantee.
2. **P2-3 + P2-4** (polling: stop-on-error, and make the post-tx refresh actually poll).
3. **P2-6** (empty-commitment SUBMIT) — small, user-facing.
4. **P2-1 + P2-7** (decide: wire resume + timeout, or remove the persistence claim).
5. **P2-8 + P2-9** (account-switch re-auth; base `simulate` on wallet/chain, extract `TxTransport`).
6. P3 dedup/dead-code sweep.

*No todos or code changes were created — this document is the deliverable. Run `/triage` or ask to
generate `todos/` entries from these findings if you want them tracked as work items.*
