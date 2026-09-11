---
title: "NestJS DI resolves dependencies as undefined under tsx/esbuild — emit decorator metadata with @swc-node/register (ESM)"
category: integration-issues
tags: [nestjs, dependency-injection, decorators, decorator-metadata, reflect-metadata, tsx, esbuild, swc, swc-node, esm, monorepo, pnpm, typescript]
module: apps/api
symptom: "NestJS constructor injection fails at boot — a provider's dependency is `undefined`, or Nest throws 'Nest can't resolve dependencies of X (?). Please make sure that the argument dependency at index [0] is available' — even though the provider is declared and imported. Running the same code compiled with `tsc` works; running it under `tsx`/`ts-node --esm`/`node --import` with an esbuild loader breaks."
severity: high
date: 2026-09-11
---

# NestJS DI breaks under tsx/esbuild: no decorator metadata emitted

## Symptom

`apps/api` (NestJS 11, ESM) booted fine when compiled with `tsc`, but the fast dev loop
(`node --import <loader> src/main.ts` / `tsx`) failed at DI resolution:

```
Nest can't resolve dependencies of OrchestrationService (?).
Please make sure that the argument ChainService at index [0] is available in the ... context.
```

or, worse, silently — a constructor param injected as `undefined`, then a `Cannot read
properties of undefined` deep inside the first request.

The provider **was** declared and exported correctly. Swapping the runner back to `tsc && node dist`
made it work, which is the tell: **the problem is the transpiler, not the wiring.**

## Root cause

NestJS constructor injection relies on **emitted decorator metadata**. With
`emitDecoratorMetadata: true`, TypeScript writes `Reflect.metadata("design:paramtypes", [ChainService])`
alongside each decorated class. Nest reads `design:paramtypes` at runtime to know what to inject.

**esbuild-based loaders (`tsx`, `esbuild-register`) do NOT emit `design:paramtypes`.** esbuild
deliberately omits the TypeScript type-reflection metadata (it would require full type resolution,
which esbuild doesn't do). So `Reflect.getMetadata("design:paramtypes", TargetClass)` returns
`undefined`, and Nest injects nothing.

This is invisible in a plain unit test that `new`s the class directly — it only bites once Nest's
DI container is the thing constructing instances.

## Solution

Run the app through **`@swc-node/register`** (SWC does emit decorator metadata) with an ESM loader,
and configure `.swcrc` to emit legacy decorators + metadata. Do **not** reach for `nest start -b swc`
in a pnpm/Turborepo monorepo (see caveat below).

**1. Make the package ESM and run `src/main.ts` through the SWC ESM loader** — `apps/api/package.json`:

```jsonc
{
  "type": "module",
  "scripts": {
    "dev":   "node --watch --import @swc-node/register/esm-register src/main.ts",
    "start": "node --import @swc-node/register/esm-register src/main.ts",
    "test":  "node --import @swc-node/register/esm-register --test 'src/**/*.test.ts'"
  },
  "devDependencies": {
    "@swc-node/register": "^1.12.1",
    "@swc/core": "^1.16.2"
  }
}
```

**2. Tell SWC to emit decorator metadata** — `apps/api/.swcrc`:

```jsonc
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },  // <-- the fix
    "target": "es2022",
    "keepClassNames": true
  },
  "module": { "type": "es6" }
}
```

**3. Keep `reflect-metadata` imported once at the entry** (`src/main.ts` top): `import "reflect-metadata";`.

**4. `tsconfig.json`** still needs `"experimentalDecorators": true` and
`"emitDecoratorMetadata": true` (used by `tsc --noEmit` typecheck and by editors).

After this, `design:paramtypes` is present at runtime and Nest DI resolves normally.

## Why NOT `nest start -b swc`

The obvious-looking alternative — `nest start -b swc` — only compiles the `apps/api` package.
In a **pnpm workspace + Turborepo monorepo**, `apps/api` imports sibling packages as raw TypeScript
(`@vouch/shared`, `@vouch/db` via `workspace:*` pointing at `src/*.ts`). `nest start -b swc` can't
transpile those workspace `.ts` files on the fly, so it fails to resolve them. Running
`node --import @swc-node/register/esm-register` registers a **process-wide** loader that transpiles
every `.ts` it touches — including the workspace packages — which is what a monorepo needs.

A compiled `dist` build (`tsc` per package + `node dist/main.js`) is the production path and also
works; the loader is purely the fast inner-loop convenience. Both were kept.

## Prevention

- **Any esbuild-based TS runner + a decorator-metadata framework (NestJS, TypeORM, class-validator,
  routing-controllers) is a trap.** The rule: if the framework reads `design:*` metadata at runtime,
  you must transpile with `tsc` or **SWC with `decoratorMetadata: true`** — never esbuild/`tsx`.
- Quick runtime probe to confirm metadata is present (should print an array of the ctor param
  classes, not `undefined`):
  ```ts
  import "reflect-metadata";
  console.log(Reflect.getMetadata("design:paramtypes", OrchestrationService));
  ```
- In a monorepo, prefer a **process-wide loader** (`node --import ...register`) over per-package
  compilers (`nest start -b swc`) so cross-package `workspace:*` `.ts` imports transpile too.

## References

- Internal: `apps/api/.swcrc`, `apps/api/package.json` (dev/start/test scripts), `apps/api/src/main.ts`.
- SWC `decoratorMetadata`: https://swc.rs/docs/configuration/compilation#jsctransformdecoratormetadata
- esbuild's stance on `emitDecoratorMetadata`: https://esbuild.github.io/content-types/#no-type-system
- Related in this repo: [[chainlink-cre-ts-sdk-confidential-workflow-wiring]] (another "TS toolchain
  vs a framework's runtime expectations" wiring problem).
