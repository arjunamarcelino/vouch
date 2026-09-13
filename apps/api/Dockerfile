# syntax=docker/dockerfile:1
# Multi-stage image for @vouch/api (NestJS 11). Build context MUST be the repo root:
#   docker build -f apps/api/Dockerfile -t vouch-api .
#
# Repo-specific notes (see docs/deployment-hosting.md):
#  - The API runs TypeScript at runtime via @swc-node/register (NOT tsx/esbuild — SWC emits the
#    `design:paramtypes` metadata NestJS DI needs). `build` is `tsc --noEmit`, so there is no dist/.
#  - We DO NOT use `pnpm deploy` here. `pnpm deploy` COPIES the @vouch/* workspace packages INTO
#    node_modules, but swc-node hard-skips anything under /node_modules/ (it will not transpile it),
#    so Node's native type-stripping then throws ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING on
#    @vouch/db/src/index.ts (which is raw TS — every @vouch/* package exports ./src/*.ts). Instead we
#    ship the FULL installed workspace at the SAME path (/repo) so node_modules/@vouch/* stay SYMLINKS
#    to /repo/packages/* — a realpath OUTSIDE node_modules — which swc-node DOES transpile, exactly as
#    in dev. The symlinks are relative, so the runtime path must be identical to the build path (/repo).
#  - Node 25+ unbundles corepack, so pnpm is pinned explicitly via corepack prepare.
#  - The `build` stage doubles as the one-shot DB migrate runner (it has prisma + psql + the full
#    workspace); the compose `migrate` service targets it. See docker-compose.yml.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /repo

FROM base AS build
# postgresql-client so this stage can also run the one-shot migrate (prisma db push + db:constraints).
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Generate the Prisma client into packages/db/src/generated (needed by the API at runtime).
RUN pnpm --filter @vouch/db codegen

FROM base AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
# Ship the full installed workspace at the SAME path so @vouch/* stay symlinks (see header note).
COPY --from=build --chown=node:node /repo /repo
# Run from the api package; its relative node_modules/@vouch/* symlinks resolve to /repo/packages/*.
WORKDIR /repo/apps/api
# Point the runtime loader at a self-contained tsconfig (no `extends`) so it never has to resolve
# @vouch/config/tsconfig-node. (@vouch/config is present in the full workspace, but keeping the runtime
# config self-contained avoids any dependency on dev-only config resolution at boot.)
ENV SWC_NODE_PROJECT=tsconfig.docker.json
USER node
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
# start = node --import @swc-node/register/esm-register src/main.ts (from the API's package.json).
CMD ["node", "--import", "@swc-node/register/esm-register", "src/main.ts"]
