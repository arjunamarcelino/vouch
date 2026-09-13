---
title: "Code Review — PR #11: /app shell, wallet+SIWE auth, /login & /demo redesigns, job flows"
pr: 11
branch: feat/web-app-shell-auth-and-flows
reviewed: 2026-09-13
reviewers:
  - security-sentinel
  - kieran-typescript-reviewer
  - julik-frontend-races-reviewer
  - architecture-strategist
  - code-simplicity-reviewer
verdict: 1 P1 (identity confusion) + 4 P2 + 6 P3.
resolution: "RESOLVED — all 11 findings fixed, one commit per issue. P1 full fix (gate address-match + ordered logout); P2s via a (marketing) route-group refactor, safeNext hardening, dead-code removal, in-flow StatusBar; P3s all fixed. <img> vs next/image accepted (wordmark blend). Committed per issue."
---

# Code Review — PR #11 `feat(web): /app shell, wallet+SIWE auth, /login & /demo redesigns, job flows`

**Scope:** `apps/web/**` (25 files, +1127/−492) — the `/app` route restructure + client auth gate, the
`/login` split-screen, the `/demo` redesign, the sidebar `AppShell`, and job Overview/Jobs/Detail flows.
Five agents reviewed the diff independently; findings were captured as `todos/105–115` (local scratch),
then fixed here. This document records the resolution.

## Verdict

| Severity | Count | Status |
|---|---|---|
| 🔴 P1 — blocks merge | 1 | ✅ fixed |
| 🟡 P2 — should fix | 4 | ✅ fixed |
| 🔵 P3 — cleanup / correctness edges | 6 | ✅ fixed (1 sub-item accepted) |

Every commit typechecks (`tsc --noEmit` on `@vouch/web`); all routes serve 200 (`/`, `/login`, `/demo`,
`/app/dashboard`, `/app/jobs`, `/app/jobs/new`, `/app/jobs/:id`); old `/dashboard` 404s.

## Positives (consensus — kept)

- **Client-side gating is the correct layer** and does not weaken authz: the server `AuthGuard`
  fail-closes on the SIWE cookie, gated pages are `"use client"` and render only after `authed`, and no
  gated data is SSR-rendered/hydrated pre-auth. The gate is UX, not the boundary.
- **Stale-cookie ↔ dead-wallet ping-pong is genuinely handled** (login forwards only on connect+session);
  the reconnect window is swallowed so a real user never flashes to `/login`.
- Listeners/timers (StatusBar popover, header scroll-spy) clean up correctly; keys are stable; the
  `Suspense` boundary around `useSearchParams` is the right App Router pattern.

---

## 🔴 P1 — fixed

### 105 — Session/wallet identity confusion → `b316a28`
Gate + `/login` admitted on session-present without checking the session address equals the connected
wallet; the `providers.tsx` account-change reconciler fired an un-awaited `/auth/logout` that raced the
`/auth/me` refetch it triggered. **Fix (full, per owner):** gate + login now require
`me.data.address === wagmi address`; the reconciler is ordered — optimistic `setQueryData(authMe, null)`
→ `await /auth/logout` → `queryClient.clear()`. Closes both the first-load and switch-race windows.

## 🟡 P2 — fixed

- **106 — `safeNext` open-redirect + dropped query string → `c1c194b`.** `safeNext` now allows only
  `^/app(/|$|?)` and bails on any backslash (rejects `//host`, `/\host`, control-char prefixes,
  `/appfoo`, `/login`); the gate carries `pathname + search` so deep links survive sign-in.
- **107 — Scattered/diverged route-chrome predicates → `d6e1598`.** Introduced an `app/(marketing)`
  route group whose layout renders SiteHeader + SiteFooter (`/`, `/demo`); `/demo` adds StatusBar via its
  own layout; the root layout is chrome-free; the `/app` gate mounts AppShell + StatusBar; `/login`
  mounts neither. SiteHeader/SiteFooter/StatusBar no longer branch on `pathname` (SiteFooter reverts to a
  server component). **Also resolves 110** — StatusBar no longer mounts on `/` or `/login`, so the authed
  `/health/integrations` probe stops firing there.
- **108 — Dead SiteHeader code → `644f24f`.** Removed the now-unreachable `APP_NAV`, its nav arm, and the
  wallet-in-header `else` branch; the header is marketing-only.
- **109 — AppShell↔StatusBar height coupling → `a3f08ae`.** StatusBar is now an in-flow `shrink-0`
  footer; the `/app` layout owns a `h-dvh` flex column and AppShell is `flex-1` — the
  `calc(100dvh-2.75rem)` magic number is gone, so the bar height lives in one place.

## 🔵 P3 — fixed

- **110 — StatusBar polling on public routes → resolved by 107** (`d6e1598`).
- **111 — Lifecycle stepper had no current marker for `ClaimPending` → `ec2cc07`.** Aliased `ClaimPending`
  (like `Completed`) onto the `ClaimPaid` resolution step.
- **112 — Wallet unreachable when sidebar collapsed → `c3bc768`.** Added a `compact` (avatar-only)
  `WalletConnectButton` variant rendered in the collapsed rail.
- **113 — Duplicated list states + syncing section → `dac1049`.** Extracted
  `JobsLoading/JobsError/JobsEmpty` shared by Overview + Jobs; `syncing` renders as an appended
  pseudo-bucket through one section map.
- **114 — DRY/consistency → `73f4983`.** Shared `APP_CONTAINER` (fixes the `sm:px-6` drift that
  misaligned loading/error states), shared `<Wordmark/>`, un-exported in-file-only `BUCKETS`, unwrapped
  side-effecting `buildBody` from `useMemo`. **Accepted:** `<img>` (not `next/image`) for the wordmark —
  the `mix-blend`/`invert` treatment is finicky under the optimizer and the box is size-reserved.
- **115 — `preparedId`-as-Idempotency-Key replacement-tx edge → `ebad1a2`.** Documented the constraint:
  tracking a different `txHash` under the same `preparedId` would 409, and the tx-engine only ever tracks
  the intent's original mined hash (fee-bumps rebind `submittedHash` for display), so it can't happen.

---

## Verification

- `tsc --noEmit` (`@vouch/web`): passes on every commit.
- Route matrix: `/`, `/login`, `/demo`, `/app/dashboard`, `/app/jobs`, `/app/jobs/new`, `/app/jobs/:id`
  all 200; `/dashboard` 404 (moved). Chrome per route confirmed via SSR: `/` header+footer, `/demo`
  +StatusBar, `/login` none.
- Client-side behaviors (gate address-match, collapsed wallet, in-flow footer) verified structurally +
  via SSR; the gate is client-side so `/app/*` SSRs a session-check spinner and hydrates after
  wallet+SIWE resolves.
