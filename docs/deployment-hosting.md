# Vouch — Deployment & Hosting

Two review paths. **Path 1 (docker-compose)** gives judges a one-command local review with no dev
tooling. **Path 2 (hosted)** is the `withvouch.xyz` scheme the maintainer deploys. Configs are
**created here; not deployed** — see `docs/mainnet-readiness-checklist.md` for the mainnet gate.

> **Honest scope of the review stack:** Path 1 delivers **browse + read live data + `/health`**.
> Click-through mutation (`openJob` / `acceptJob` / `openClaim`) is on-chain via the reviewer's own
> browser wallet + SIWE and needs a funded Arc-testnet wallet — that flow is shown in the demo video
> and `docs/screenshots/`, not required to review the app.

## Domain scheme

| Service | Domain | Host | Notes |
|---|---|---|---|
| web (`@vouch/web`, Next.js 16) | `https://withvouch.xyz` | Vercel | `NEXT_PUBLIC_*` are **build-time** env |
| api (`@vouch/api`, NestJS 11) | `https://api.withvouch.xyz` | container | `apps/api/Dockerfile` |
| agent (`@vouch/agent`, Fastify) | `https://agent.withvouch.xyz` | container | prefer **private/api-only**; single instance |
| Postgres | — | managed | never publicly exposed |

## Path 1 — one-command local review

```bash
cp .env.review.example .env.review     # public live coordinates; key-type vars stay placeholders
docker compose up --build              # web :3000, api :3001, agent (internal), postgres (localhost)
```
Open **http://localhost:3000 only** — the `__Host-vouch_session` cookie requires a Secure context;
`localhost` qualifies, a LAN IP over http does not. The `migrate` service applies the schema
(`prisma db push` — there are no migration files) + manual constraints, then api/agent start.

## Path 2 — hosted deploy (maintainer)

**web on Vercel:** set Root Directory = `apps/web` (Vercel auto-detects Turborepo), or use
`apps/web/vercel.json`. Set every `NEXT_PUBLIC_*` as **build-time** Environment Variables (they are
inlined into the browser bundle; they are also declared in `turbo.json` `tasks.build.env` so remote
cache never serves a stale bundle). `serverExternalPackages` + `transpilePackages` + **pinned wagmi
v2** must be preserved (a fresh install that drifts wagmi→v3 breaks RainbowKit).

**api + agent as containers:**
```bash
docker build -f apps/api/Dockerfile   -t vouch-api   .
docker build -f apps/agent/Dockerfile -t vouch-agent .
```
Both run TypeScript at runtime (api via `@swc-node/register`, agent via `tsx`) — the loaders are
runtime `dependencies`, and `pnpm deploy --legacy --prod` (legacy because of catalogs) keeps them.

## Production hardening (already wired)

- **CORS** (`apps/api/src/main.ts`): exact-match allowlist `Set` from `WEB_ORIGIN` (comma-separated,
  parsed to `string[]`) with `credentials:true`. **Never** a regex/substring — `origin.includes(...)`
  would match `withvouch.xyz.evil.com`. Add Vercel preview origins explicitly if you allow them.
- **Cross-subdomain cookie:** the session cookie is `__Host-vouch_session` (`SameSite=Strict; Secure`,
  host-locked, no `Domain`). It works for `withvouch.xyz → api.withvouch.xyz` only because they share
  the registrable domain and **both are HTTPS**. Keep them on the same eTLD+1; set `SIWE_DOMAIN` and
  `WEB_ORIGIN` to the exact host.
- **Env fail-closed** (zod): outside `development`, api requires `SESSION_SECRET`, `SIWE_DOMAIN`,
  `WEB_ORIGIN`, `AGENT_API_KEY`; agent requires `AGENT_API_KEY` and forbids `AGENT_ALLOW_MANUAL_PAY=true`.
- **Rate limiting:** api `@nestjs/throttler` (ttl is **ms** in v6); agent has an in-memory per-IP
  limiter. Both are **per-instance in-memory** — behind a proxy set `trust proxy` so limits key on the
  real client IP, and enforce edge rate-limiting for anything public. This is why the agent is a
  **single instance** (see below).
- **Swagger** (`/docs`, `/openapi.json`) is served off-mainnet; it is gated off when `CHAIN_ENV=arc-mainnet`.

## Agent = single always-on instance

The agent runs a long-lived monitor loop + 30s reconcile timer. **No scale-to-zero** (it would miss
events) and **no horizontal autoscale** (N pollers double-emit; the rate limiter is per-instance).
Run exactly one replica; wire `GET /health` as the liveness probe. The web never calls the agent —
only the api does, server-side — so keep `agent.withvouch.xyz` **private / api-only** if possible; if
it must be public, `AGENT_API_KEY` (fail-closed) is load-bearing.

## Secret hygiene for hosting

- Real RPC keys, `GRAPH_DEPLOY_KEY`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `SESSION_SECRET`,
  `QUOTE_SIGNER_PK` live in the **platform secret store** — never in `*.example`, an image layer, or a
  committed file. `pnpm gate:secrets` content-scans `*.example` (key-type vars must be blank) and
  catches keyed provider URLs / 32- & 64-hex secrets.
- **Circle-side spend controls + minimal wallet funding** are the real cap for a hosted agent that can
  move USDC — the entity secret bypasses the in-process `AGENT_PER_TX_CAP`/`AGENT_DAILY_CAP`. Fund the
  wallet at/below the daily cap and configure Circle-side policy before exposing the agent.

## Screenshot / diagram capture hygiene (enforced before committing any image)

Screens are captured against a fully-configured stack, so before committing anything under
`docs/screenshots/` or an exported SVG:
- Throwaway browser profile; **no** terminal pane showing a sourced `.env`/`export`/`Authorization:
  Bearer`, **no** DevTools Network/Application (cookies/JWT) pane, **no** editor pane with an env file,
  **no** Circle console.
- Strip metadata (`exiftool -all= <img>`), and prefer PNG over SVG (a browser-exported SVG can bake in
  absolute home paths / tokens — `gate:secrets` text-scans committed SVGs for those).
