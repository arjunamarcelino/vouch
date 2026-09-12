# syntax=docker/dockerfile:1
# Multi-stage image for @vouch/api (NestJS 11). Build context MUST be the repo root:
#   docker build -f apps/api/Dockerfile -t vouch-api .
#
# Repo-specific notes (see docs/deployment-hosting.md):
#  - The API runs TypeScript at runtime via @swc-node/register (NOT tsx/esbuild — SWC emits the
#    `design:paramtypes` metadata NestJS DI needs). `build` is `tsc --noEmit`, so there is no dist/;
#    @swc-node/register + @swc/core are runtime `dependencies`, so `pnpm deploy --prod` keeps them.
#  - `pnpm deploy` requires `--legacy` here: the repo uses pnpm catalogs, incompatible with the
#    inject-workspace-packages that deploy otherwise needs.
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
# Prune to a self-contained, prod-only deployment of the API (workspace deps injected). --legacy is
# REQUIRED because catalogs are incompatible with inject-workspace-packages (pnpm#8950).
RUN pnpm deploy --legacy --filter=@vouch/api --prod /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
# start = node --import @swc-node/register/esm-register src/main.ts (from the API's package.json).
CMD ["node", "--import", "@swc-node/register/esm-register", "src/main.ts"]
