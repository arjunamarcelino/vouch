---
title: "Landing shipped ~7.45 MB of oversized PNGs (raw <img>/CSS background) — WebP + next/image cut it ~45×"
category: performance-issues
tags: [next-image, sharp, webp, cwebp, lcp, images, assets, apps-web, landing, tailwind]
module: apps/web
symptom: "The marketing landing loaded ~7.45 MB of PNGs through plain <img> and a CSS background-image (hero was the LCP element; 1254×1254 stat icons rendered at ≤96px), bypassing Next's image pipeline — slow LCP and huge transfer on a page whose whole point is a fast first impression."
root_cause: "Static 3D-render art (bg-hero.png 1.8 MB, icon-asset.png sprite 1.3 MB, four icon-stats-*.png ~1 MB each) was added straight to /public and referenced with raw <img src>/`background-image: url(...)` — no next/image, no WebP/AVIF, no srcset, no resize, no lazy/priority. Intrinsic sizes were 4–40× the display box."
date: 2026-09-13
---

# Landing image payload: ~7.45 MB of PNGs → 164 KB (WebP + next/image)

## Symptom

The redesigned landing (`apps/web/app/page.tsx`) shipped six large PNGs:

| asset | intrinsic | displayed | file | role |
|---|---|---|---|---|
| `bg-hero.png` | 1536×1024 | ~555px (hero, `lg:col-span-5`) | 1.80 MB | **LCP element**, eager |
| `icon-asset.png` | 1774×887 | ~112px sprite (3 pillars) | 1.29 MB | CSS `background-image` |
| `icon-stats-1..4.png` | 1254×1254 ea. | ≤96px (`size-24`) | ~4.3 MB total | below-fold, eager |

Total: **7,450,461 bytes**, all via raw `<img>`/CSS background — Next's image optimizer was never engaged. On mid-tier mobile / slow links this inflates LCP directly (the hero PNG is the LCP candidate) and downloads ~4 MB just to paint four 64–96px thumbnails.

Surfaced by a multi-agent PR review (performance-oracle rated it P1; architecture + typescript concurred). See `todos/094`.

## Investigation / options weighed

- **next/image alone** — great for the `<img>` surfaces, but (a) needs `sharp` for production optimization under `output: "standalone"`, and (b) **cannot touch a CSS `background-image`** (the pillars sprite), so that 1.3 MB PNG would stay.
- **Downscale + WebP (cwebp) + keep raw `<img>`** — no framework change, cuts most bytes, but loses `srcset`/AVIF/priority/lazy niceties.
- **Chosen: hybrid.** Pre-encode every asset to a downscaled WebP with `cwebp` (so even the sources are lean), then serve the two raster surfaces via `next/image` and the sprite via a WebP CSS background. Best of both: tiny sources + optimized client delivery, and the sprite problem is solved.

## Root cause

Static art was dropped into `/public` and referenced directly. `next/image` is not used anywhere by default, and a CSS `background-image` can never be optimized by it — so the sprite in particular needed a separate answer.

## Solution

### 1. Pre-encode to downscaled WebP with `cwebp` (Homebrew: `brew install webp`)

```bash
cd apps/web/public
cwebp -quiet -q 80 -resize 1280 0 bg-hero.png  -o bg-hero.webp     #  1.80 MB -> 98 KB
cwebp -quiet -q 85 -resize 600  0 icon-asset.png -o icon-asset.webp #  1.29 MB -> 37 KB
for n in 1 2 3 4; do
  cwebp -quiet -q 85 -resize 192 192 icon-stats-$n.png -o icon-stats-$n.webp  # ~1 MB -> ~7 KB each
done
# then remove the source PNGs (git rm)
```

Result: **7,450,461 → 164,880 bytes (~45×)**. `-resize W 0` keeps aspect (auto height). Target ~2× the display box for retina.

### 2. Add `sharp` (Next needs it to optimize in production/standalone)

```bash
pnpm add sharp --filter @vouch/web
```

### 3. `next/image` for the raster surfaces

```tsx
import Image from "next/image";

// Hero — fills a fixed-aspect container; priority because it's the LCP element.
<div className="animate-float relative aspect-[3/2] overflow-hidden rounded-3xl">
  <Image src="/bg-hero.webp" alt="…" fill sizes="(min-width: 1024px) 40vw, 100vw" priority className="object-cover" />
</div>

// Stat icons — explicit width/height (2× the 48px box); lazy by default (below the fold).
<Image src={s.img /* /icon-stats-N.webp */} alt="" aria-hidden width={96} height={96} className="size-16 sm:size-20 lg:size-24 object-contain" />
```

`fill` needs a `relative` + sized container (here `aspect-[3/2]` matches 1536×1024). `sizes` tells the optimizer the real rendered width so it doesn't over-serve.

### 4. Sprite stays a CSS background — just point it at the WebP

The three pillars share one sprite, each showing a third via `background-position` (0% / 50% / 100%) with `background-size: 300% 100%` and an `aspect-[591/887]` box — no `next/image` involved:

```tsx
<span style={{ backgroundImage: "url(/icon-asset.webp)", backgroundSize: "300% 100%", backgroundPosition: `${pos} center` }} />
```

### Verify

`/_next/image?url=%2Fbg-hero.webp&w=1080` etc. appear in the DOM (optimizer engaged), no console/image errors, and `pnpm --filter @vouch/web build` succeeds.

## Prevention

- **Default to `next/image` for any raster asset.** Reserve raw `<img>` for SVGs (logos/wordmarks) and cases needing CSS blend modes.
- **Pre-encode art to WebP at ~display size before committing.** A 1254×1254 PNG for a 96px icon is ~170× the needed pixel area; `next/image` fixes client delivery but a lean source keeps the repo/optimizer light.
- **Anything that must be a CSS `background-image`** (sprites, decorative fills) → WebP by hand; `next/image` can't help there.
- **Give `next/image` `priority` only for the LCP element**, everything else stays lazy; always pass `sizes` for `fill`.
- Watch the PR diff for new large binaries in `apps/web/public/` — a quick `ls -S` catches multi-MB PNGs.

### Deployment consideration (sharp + standalone/Docker)

`apps/web/Dockerfile` builds `output: "standalone"` on `node:22-slim` (Debian/glibc), which matches `sharp`'s default prebuilt binary, so the traced standalone bundle serves `/_next/image` fine. If the runtime base ever moves to Alpine/musl, install `sharp`'s musl binary (or keep it a glibc image), or the image optimizer will 500 at runtime. Build-vs-runtime arch must also match (e.g. don't build arm64 sharp for an amd64 runtime).

## Cross-references

- Todo: `todos/094-complete-p1-landing-image-payload-optimization.md`
- PR: https://github.com/arjunamarcelino/vouch/pull/10 (commit `perf(web): optimize landing image payload via WebP + next/image [094]`)
- Related in the same review pass: `todos/104` (motion perf — will-change / off-screen interval).
- Deployment: `docs/deployment-hosting.md`, `apps/web/Dockerfile`.
