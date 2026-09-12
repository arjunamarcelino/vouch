# Vouch — Official Submission Video Script (2–4 min)

> **This is THE ETHOnline 2026 submission video.** One human-narrated end-to-end run that chains all
> three sponsors in a single flow. It **leads with The Graph** (the marquee $5,000 track) because the
> subgraph is load-bearing — the agent literally cannot quote without it — then carries the same job
> through autonomous USDC settlement on **Arc** and a confidential **Chainlink CRE** verdict.
>
> The extended ≤5-min deep-dive is [`demo-script.md`](demo-script.md). Per-track written judging
> narratives: [`demo-script-graph.md`](demo-script-graph.md) (this file, video + Graph),
> [`demo-script-arc.md`](demo-script-arc.md), [`demo-script-chainlink.md`](demo-script-chainlink.md).

---

> ## ⚠️ VIDEO PRODUCTION RULES (auto-reject if broken)
>
> These are hard ETHOnline gates. Violate any one and the submission is auto-rejected before judging.
>
> - **Length: 2:00–4:00.** Under 2:00 or over 4:00 → auto-reject. Target **3:15** to leave margin.
> - **Resolution: 720p minimum.** Record and export at 1080p to be safe.
> - **HUMAN narration only.** No AI voice, no TTS, no voice cloning. A person must speak the script.
> - **No speed-up.** Do not accelerate footage, timelapse, or jump-cut around real latency. If a tx or
>   an index takes time to confirm, cut to a pre-confirmed tab (recorded earlier, same run) rather than
>   speeding the clip.
> - **Not recorded on mobile.** Capture on a desktop/laptop screen recorder.
> - Assessed by **all three partners** from this one video — every sponsor beat below must be visible.

---

## Pre-record checklist (off-camera, ≈1 min)

- [ ] `pnpm demo:health` → every leg you'll show is 🟢 (Arc RPC + chainId 5042002, `AssuranceHub`
      bytecode at `0xB30e…2bf9`, subgraph indexing within lag budget, agent/api health). Unconfigured
      legs are honest but **must not** be narrated as live — keep them off-camera.
- [ ] `pnpm gate:secrets` → **PASSED** (run before showing any terminal, so no secret can leak).
- [ ] Studio endpoint reachable: `https://api.studio.thegraph.com/query/1760065/vouch/v0.0.2`
      (slug `vouch`, v0.0.2, CID `QmaoAwseMjoD3EMFwhQf3KBqqyac7sa4anpUBxK7iwEM8p`). Query with your
      **Studio API key**. **Studio dev cap = 3,000 queries/day** — rehearse with ≤ a few dozen queries
      and don't loop a polling tab during recording.
- [ ] CRE harness runs clean: `node --import tsx packages/cre-workflow/harness.ts
      packages/cre-workflow/fixtures/valid-failure.json` → verdict `PAYOUT`, **no secret in output**.
- [ ] Arc wallet funded (USDC-as-gas from faucet); a real `testnet.arcscan.app` tx link opens.
- [ ] Tabs pre-opened in order: (1) landing, (2) Studio GraphiQL, (3) agent quote / `/providers/[addr]`,
      (4) the agent's Circle wallet balance, (5) an arcscan tx tab, (6) a terminal for the CRE harness.

---

## The run (target 3:15, hard bounds 2:00–4:00)

| Time | Beat | On screen | Say (human narration) |
|---|---|---|---|
| **0:00** | **Problem hook** | Landing page / one slide | "Acceptance tests are point-in-time. An AI coding agent can pass the public suite, get accepted and **paid** — then a regression only a **private** test catches shows up later. Once the fee is released, the client has no recourse. Vouch adds a **confidential, post-acceptance coverage window** that fixes exactly that." |
| **0:25** | **Create job + guarantee** | `/jobs/new`: approve + `openJob` (**20 USDC** task fee escrowed); provider `acceptJob` locks capped guarantee collateral | "A client funds a 20-USDC coding job. A provider **voluntarily** locks a **capped, provider-funded** performance guarantee. That lock is the agreement — enforced on-chain by the Arc `AssuranceHub`." |
| **0:50** | **THE GRAPH — live risk quote** | Studio GraphiQL: run `risk-agent-input.graphql` for the provider → real `upheldClaimRateBps`, `recentFailureRateBps`, `jobsCompleted`, `_meta.block`. Then the agent's `/quote` → `premiumBps`, `recommendedGuaranteeCap`, stamped `asOfBlock` + `scoringFnVersion` | "This is the marquee. I query our **deployed Subgraph Studio** endpoint with an **API key** — real indexed Arc history round-trips right here. The risk agent feeds those exact signals into a **pure pricing function**: no fixture, no DB mirror, no on-chain aggregate. The subgraph is **load-bearing** — the quote is impossible without it." |
| **1:25** | **THE GRAPH — fail-closed (503)** | Point the agent at a lagging/paused index (lower `SUBGRAPH_MAX_LAG_BLOCKS` or pause the node); agent throws `SUBGRAPH_STALE`/`LAGGING`, API returns **503**; restore → quote returns | "And when the index is stale, the agent **refuses** — 503, no quote — rather than fabricate history. Fail-closed on reputation data is the whole point. Restore the index, and the quote comes right back." |
| **1:50** | **ARC — autonomous USDC settlement** | The agent's **policy-capped Circle wallet** USDC balance; the real `postBond` tx open on `testnet.arcscan.app` (bond post `0x5d9d1af8…`, refund `0xd668c466…`) | "Settlement is **real USDC on Arc**. The agent's Circle Agent-Stack wallet moves funds via **contract execution only** — per-tx and daily caps plus a destination allowlist — here's the confirmed `postBond` transaction on arcscan. Honest scope: the agent is **transport**; it posts its own refundable quote-bond and **never** settles the guarantee principal." |
| **2:20** | **Commit → public tests → fee released** | `/jobs/[id]`: `submitDeliverable` (commit hash) → evaluator `resolveInitialEvaluation(approve)` → **20 USDC task fee → provider**, `CoverageStarted` (24h window opens) | "Provider submits a commit hash. Public tests pass, the evaluator approves — **the 20-USDC fee is released**. This job was **validly accepted and paid**. And now a 24-hour **coverage window** opens." |
| **2:40** | **CHAINLINK — confidential CRE test** | `/jobs/[id]/claim` → CRE progress; terminal: `harness.ts fixtures/valid-failure.json`. Pause on the log | "Within coverage, the client opens a claim. A **Chainlink CRE Confidential Workflow** runs the **private** regression test **inside a Nitro TEE** (`handlerInTee`). Watch the log — the repo token, the private test, and the pass threshold **never appear**." |
| **3:00** | **Capped payout** | Harness verdict `PAYOUT` (7-tuple) → `onReport` → `GuaranteePaid` + `CollateralReleased`, state → `ClaimPaid`; UI shows capped credit → client (covered claim on jobId 1: `0x9659db91…`) | "The confidential test proves a **covered** failure. The DON-signed 7-tuple verdict is the **sole gate** on the payout: `onReport` finalizes the claim and the client receives the capped service credit — `min(amount, guaranteeAmount)`, remainder to the provider." |
| **3:05** | **Reputation re-quote rises** | Re-run the agent quote for the same provider once `_meta.block ≥ payout block`: `upheldClaimRateBps` moved (10000→5000 path), `premiumBps` **2000** (capped), reason `UPHELD_CLAIM_RISK`, **lower** cap | "The Graph indexes the claim. Ask for a **new quote** on the same provider — the upheld claim raised the risk signals, so the premium is **higher** and the offered cap **lower**. Reputation is live, on-chain, and consequential." |
| **3:15** | **Close** | Thesis slide | "The job was validly accepted and paid — but assurance still protected the client from a later, **covered** failure. That post-acceptance, confidential coverage window is Vouch." |

---

## Honest caveats to keep on hand (say briefly if a beat prompts it; full model in the deep-dive)

- **Live-with-honest-caveats.** Everything shown is real output. The one thing we **don't** claim: on
  Arc testnet there is **no canonical KeystoneForwarder**, so settlement rides a **trusted EOA relay** —
  no on-chain DON-signature verification yet. The TEE guarantees **confidentiality of inputs**, not
  attested integrity of the output. `simulate`/harness is a single local node, not proof of on-chain
  delivery. (Full model: [`demo-script-chainlink.md`](demo-script-chainlink.md) and
  [`security.md`](security.md).)
- **What's autonomous:** the agent quotes from live Graph data and posts an operational quote-bond. It
  does **not** auto-post the guarantee and never moves guarantee principal — a disclosed, logged no-op
  on the job→bond-release linkage.

---

## Why this satisfies all three tracks in one video

- **The Graph (0:50–1:50, 3:05):** a real Studio-with-API-key query round-trip (qualifies per the 2026
  rule; mocked/local/static datasets do not), the agent's quote as a **pure function** of indexed data,
  fail-closed 503 on stale data, and a reputation re-quote that visibly moves after an indexed claim.
- **Arc / Circle Agent Stack (1:50–2:20):** a real autonomous USDC action on Arc from a policy-capped
  Circle wallet, contract-execution-only, with a live arcscan tx link.
- **Chainlink CRE (2:40–3:15):** the private verdict computed inside `handlerInTee` (Nitro), the secret
  never surfacing, and the DON-signed 7-tuple as the sole payout gate. Simulate/harness evidence is
  explicitly accepted for this track.
