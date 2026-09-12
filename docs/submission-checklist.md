# Vouch — Pre-Submit Gate Checklist (ETHOnline 2026)

Run this checklist **before** hitting submit. Every box must be checked or explicitly
waived. It gates the three sponsor tracks (The Graph, Arc / Circle Agent Stack,
Chainlink CRE) plus the required demo video and repo hygiene.

Facts source of truth: the deployment coordinates and per-track evidence live in
[`DEPLOYMENT.md`](DEPLOYMENT.md), [`evidence/index.md`](evidence/index.md),
[`the-graph-demo.md`](the-graph-demo.md), [`arc-agent-stack.md`](arc-agent-stack.md),
and [`chainlink-confidential-workflow.md`](chainlink-confidential-workflow.md).

---

## 0. Repo & README

- [ ] Repository is **public**.
- [ ] `README` is present and its documented quickstart is **runnable** (fresh clone → install → build/dev).
- [ ] `LICENSE` present (MIT) and matches the license cited in the README.

## 1. Demo video (ONE required — hard rules, auto-reject on any miss)

- [ ] Duration **2–4 minutes** (outside this range = auto-reject).
- [ ] **720p or higher** resolution.
- [ ] **Human narration** — no AI/TTS voice.
- [ ] **Not sped-up** / no time-lapse of the walkthrough.
- [ ] **Not recorded on mobile.**
- [ ] Link resolves and is publicly viewable by all three partners.

## 2. The Graph track

- [ ] **"Start Fresh" pool** selected for the subgraph (not an existing/migrated pool).
- [ ] A **live Subgraph Studio query** (with API key) is shown in the demo — not mocked, local-only, or static data.
- [ ] Studio dev endpoint stays **under 3,000 queries/day** during judging.
- [ ] The subgraph is demonstrated as **load-bearing**: the agent's risk quote is a pure function of indexed data (fail-closed when the index is stale/lagging/unavailable).

## 3. Arc / Circle Agent Stack track

- [ ] **Frontend + backend are live** and reachable.
- [ ] **Architecture diagram** present (Arc explicit requirement) and exported (PNG).
- [ ] At least one **Circle Agent Stack component** is cited and load-bearing (`@circle-fin/developer-controlled-wallets`).
- [ ] Real **arcscan transaction links** listed and each resolves (bond post + refund + lifecycle txs).
- [ ] **Mainnet readiness documented** ([`mainnet-readiness-checklist.md`](mainnet-readiness-checklist.md)).

## 4. Chainlink CRE track

- [ ] **`handlerInTee`** shown in the workflow (nitro TEE constraint).
- [ ] **Secret material stays in the enclave** (Vault DON `{{.token}}` template, `getSecret`, `confidentialFetch`).
- [ ] **Simulate evidence** captured: CRE CLI run showing `REPORTED:PAYOUT`.
- [ ] **No secrets in any evidence artifact** (verdict-only declassification; sentinel not echoed).

## 5. Cross-cutting

- [ ] **All links resolve** — arcscan txs, Studio endpoint, video, docs, diagram.
- [ ] **`pnpm gate:secrets` → PASS** (no tracked secret, positive control asserts secret consumed).
- [ ] **`pnpm demo:health` → green.**
- [ ] **Contract addresses + endpoints listed with network id** (AssuranceHub, QuoteBondEscrow, USDC, RPC, subgraph endpoint — each tagged with chain id / network name).
- [ ] **Git history is incremental** — no giant single "initial commit" dump.
- [ ] **Final commit landed** on the submission branch and pushed.
