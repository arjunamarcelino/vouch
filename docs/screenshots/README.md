# Lifecycle screenshots — capture spec

> **Status: to be captured against the live/hosted app before submission.** These are intentionally
> NOT committed as fabricated images — the honesty rule forbids staged/faked evidence. Capture them
> against `https://withvouch.xyz` once deployed, or the Path-1 `docker compose up` stack + a funded
> Arc-testnet browser wallet (the write path needs SIWE + a wallet). See
> [`../deployment-hosting.md`](../deployment-hosting.md).

Capture these **5 hero shots** (the demo video carries the full 10-step lifecycle; README/SUBMISSION
only need these). Save as `NN-name.png`, reference from `README.md` and `SUBMISSION.md`.

| File | Screen | What must be visible |
|---|---|---|
| `01-landing.png` | Landing / dashboard | The product, network = Arc testnet, live USDC balances |
| `02-live-quote.png` | Provider / new-job quote | Graph-derived risk signals → `premiumBps`, stamped `asOfBlock` (The Graph load-bearing) |
| `03-cre-payout.png` | Terminal: `simulate:harness fixtures/valid-failure.json` | `verdict: PAYOUT`, and the secret is ABSENT from the log |
| `04-guarantee-paid.png` | `testnet.arcscan.app` tx | The `GuaranteePaid` payout tx confirmed on-chain |
| `05-requote-higher.png` | Provider quote after upheld claim | Premium rose / cap lowered — reputation is live and consequential |

## Capture hygiene (enforced before committing ANY image — security C3)

- Use a **throwaway browser profile**; no wallet seed/private-key screens.
- **No** terminal pane showing a sourced `.env` / `export` / `Authorization: Bearer …`.
- **No** DevTools Network/Application (session cookie, JWT) pane open.
- **No** Circle console / API-key screen.
- Strip metadata after capture: `exiftool -all= docs/screenshots/*.png`.
- PNG only (no SVG). `pnpm gate:secrets` text-scans committed SVGs; raster images can't be
  text-scanned, so this checklist is the gate — eyeball every image for visible secrets before commit.
