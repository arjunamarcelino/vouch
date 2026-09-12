# syntax=docker/dockerfile:1
# Multi-stage image for @vouch/agent (Fastify + long-lived monitor loop). Build context = repo root:
#   docker build -f apps/agent/Dockerfile -t vouch-agent .
#
# Notes: the agent runs TypeScript at runtime via tsx (a runtime `dependency`, so --prod keeps it);
# `build` is `tsc --noEmit`. `pnpm deploy` needs `--legacy` (catalogs). It is a SINGLE always-on
# instance — no scale-to-zero, no horizontal autoscale (the monitor loop + reconcile timer would
# double-run and the in-memory rate limiter is per-instance). See docs/deployment-hosting.md.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @vouch/db codegen
RUN pnpm deploy --legacy --filter=@vouch/agent --prod /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3002
ENTRYPOINT ["/usr/bin/tini", "--"]
# start = tsx src/index.ts (from the agent's package.json).
CMD ["node", "--import", "tsx", "src/index.ts"]
