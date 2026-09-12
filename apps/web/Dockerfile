# syntax=docker/dockerfile:1
# Multi-stage image for @vouch/web (Next.js 16, output:"standalone"). Build context = repo root:
#   docker build -f apps/web/Dockerfile -t vouch-web \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.withvouch.xyz .
#
# IMPORTANT: NEXT_PUBLIC_* are INLINED AT BUILD TIME into the browser bundle — they must be passed as
# --build-arg here (and declared in turbo.json tasks.build.env so remote cache doesn't serve a stale
# bundle). Passing them only as runtime `environment:` is too late. On Vercel, set them as build-time
# env instead of using this image. See docs/deployment-hosting.md.

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_CHAIN_ENV
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_ARC_RPC_URL
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_CHAIN_ENV=$NEXT_PUBLIC_CHAIN_ENV \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_ARC_RPC_URL=$NEXT_PUBLIC_ARC_RPC_URL \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@vouch/web...

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Next standalone output (monorepo layout): server + traced node_modules, then static + public.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
