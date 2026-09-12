---
title: "Fixing pnpm audit highs via overrides: bound the range and verify the AFFECTED layer, not just 'tests pass'"
category: build-errors
tags: [pnpm, dependencies, supply-chain, audit, overrides, prisma, monorepo]
module: pnpm-workspace.yaml
symptom: "`pnpm audit --prod` reports HIGH/CRITICAL advisories, all in deep-transitive deps (via wagmi/WalletConnect, NestJS, Prisma) with no direct upgrade path. Adding open-ended `>=` overrides clears the audit, but the 'verified green' claim rests on typecheck/build/unit suites that never exercise the actually-affected code path."
root_cause: "Two traps: (1) open-ended `>=` overrides let a future `pnpm update` pull an untested MAJOR into a deep consumer; (2) 'all suites green' is not evidence the override is safe when the suites don't touch the affected layer (e.g. a Prisma-internal dep like deepmerge-ts under @prisma/config, exercised only by `prisma generate`/config merge)."
date: 2026-09-12
---

# pnpm audit highs: override with a BOUND, and verify the layer the dep actually touches

## Symptom

`pnpm audit --prod` flags several HIGH advisories, every one a deep-transitive dependency with no
direct-dep fix (e.g. `ws` via wagmi→WalletConnect→viem; `multer` via `@nestjs/platform-express`;
`mysql2`/`deepmerge-ts` via Prisma; `axios` via a Coinbase SDK under wagmi). None is a direct
dependency, so the standard fix is a package-manager override to the patched version.

## Two traps

1. **Open-ended `>=` overrides.** `ws: ">=8.21.0"` clears today's CVE, and `>=` correctly prevents a
   *downgrade* — but it has no ceiling, so a later lockfile refresh / `pnpm update` can pull an
   untested **major** (ws 9.x, axios 2.x, deepmerge-ts 9.x) into a deep consumer with zero review. It
   is also stylistically inconsistent with a bounded catalog (`zod`/`viem`/`typescript` use caret
   ranges).
2. **"All suites green" ≠ verified.** typecheck + build + unit/contract suites frequently do **not**
   exercise the code the bumped dep actually drives. The sharpest case here: `deepmerge-ts` is used by
   `@prisma/config` to merge `prisma.config.ts` — a major with different array/`undefined` merge
   semantics could silently change Prisma config composition (affecting `prisma generate`/`migrate`),
   and **no TS/unit test would catch it**. Likewise `multer` ≥2 is a breaking major for NestJS upload
   handling that the unit suite never touches.

## Solution

Bound each override to the vetted major, and run a smoke of the **specific layer** the dep touches:

```yaml
# pnpm-workspace.yaml — security floor WITH an upper bound so no untested major slips in.
overrides:
  ws: ">=8.21.0 <9"
  axios: ">=1.18.0 <2"
  multer: ">=2.3.0 <3"
  mysql2: ">=3.22.0 <4"
  deepmerge-ts: ">=8.0.0 <9"   # @prisma/config uses this to merge prisma.config.ts
```

```bash
pnpm install                              # re-resolve; confirm it lands on versions the consumer expects
pnpm audit --prod                         # confirm 0 high/critical
# Verify the AFFECTED layer, not just the generic suites:
pnpm --filter @vouch/db codegen           # prisma generate — exercises the deepmerge-ts config merge
DATABASE_URL=… pnpm --filter @vouch/db exec prisma validate   # loads prisma.config.ts + schema
```

If a bumped dep drives an untested runtime path (e.g. `multer` file uploads), either add a smoke test
for it or explicitly note in the override comment that the path is unexercised.

## Prevention

- **Every security-floor override gets an upper bound** to the vetted major. `>=X` alone is a
  standing invitation for an untested major on the next `pnpm update`.
- **Name what you verified, in the override comment.** "install + typecheck + build + tests green" is
  misleading if none of those touch the dep. State the actual layer smoke (`prisma generate`/
  `validate`, an upload test, etc.).
- **Prefer overriding a transitive over a direct upgrade only when there's no direct path** — and
  record why (deep-transitive, no direct dependency) so the override is auditable.
- Leave remaining **moderate** advisories documented (in `docs/security.md`) rather than silently
  carried — the "fix high/critical, document the rest" rule.

## References

- PR #7 review todo `074`. Overrides added in commit `854731c`.
- Related: [`psql-rejects-prisma-schema-query-param-dsn.md`](../database-issues/psql-rejects-prisma-schema-query-param-dsn.md)
  (another "the DB layer needs its own verification step" lesson).
