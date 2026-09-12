---
title: "Opaque monochrome logo showed a white box in light theme — keyed the background out per-theme with mix-blend-mode (+ isolation)"
category: ui-bugs
tags: [css, tailwind, mix-blend-mode, isolation, dark-mode, logo, nextjs, theming]
module: apps/web
symptom: "A header wordmark (black ink baked onto a solid white PNG, no alpha) rendered a visible white rectangle over the off-white (zinc-50) surface in light theme. `dark:invert` alone only 'worked' in dark theme by coincidence of the monochrome art."
root_cause: "The PNG is 8-bit RGB (no alpha) — a solid white background is baked in, so it paints as a box over any non-pure-white surface. No transparent/SVG wordmark asset was available, and no image tooling (sharp/ImageMagick) was installed to alpha-key one."
date: 2026-09-13
---

# Keying out an opaque monochrome logo background per theme (no re-export)

## Symptom

Header logo: `<img src="/logos/vouch/vouch.png" …>`, where `vouch.png` is `828×285, 8-bit/color RGB`
(**no alpha** — solid white background). The site header surface is `--color-surface: oklch(0.985 …)`
(zinc-50, off-white) in light theme, near-black in dark. The baked white bg showed as a faint box in
light theme. The original `className="… dark:invert"` masked it in dark theme only because inverting a
pure black-on-white image happens to yield white-on-black — a coincidence of the art, not a technique.

## Root cause

An RGB (alpha-less) monochrome asset can't be made transparent by CSS filters alone. The robust fixes
(transparent PNG, or an SVG with `currentColor` ink) needed either a new asset or image tooling, and in
this environment there was **no `sharp`, no ImageMagick**, and the transparent sibling asset was a
square logo, not the horizontal wordmark.

## Working solution

Key the solid background out with blend modes, per theme — no new asset:

```tsx
// apps/web/components/shell/SiteHeader.tsx
<header className="sticky top-0 z-30 isolate … bg-surface/90 backdrop-blur …">
  …
  <img
    src="/logos/vouch/vouch.png"
    alt="Vouch"
    width={828} height={285}   // intrinsic size reserves the box → no first-paint reflow
    className="h-6 w-auto mix-blend-multiply dark:mix-blend-screen dark:invert"
  />
```

Why it works (blend math in 0–1 space):

- **Light — `multiply`** (`base × blend`): white bg (`1`) × backdrop = backdrop (bg vanishes); black
  ink (`0`) × backdrop = `0` (stays black).
- **Dark — `invert` then `screen`** (`1 − (1−base)(1−blend)`): invert flips ink→white, bg→black; a black
  blend pixel (`0`) → `base` (the now-black bg disappears into the dark header), white ink is preserved.

### The non-obvious part: `isolation: isolate` is mandatory here

`mix-blend-mode` blends the element against its **backdrop** — the accumulated paint *behind* it in the
same stacking context. This header is translucent (`bg-surface/90 backdrop-blur`), so without isolation
the logo blends against **page content scrolling underneath the sticky bar**, and the white-key
flickers as you scroll. Adding `isolate` (Tailwind for `isolation: isolate`) to the header creates a new
stacking context, confining the blend to the header's own background. This turns a "fixed but flaky"
result into a stable one.

## Prevention

- For a **pure** black-on-white monochrome mark over a **flat/opaque** background, this blend trick is a
  legitimate no-asset fix. Anti-aliased/JPEG-fringe edges (gray, not pure white/black) won't fully key
  out → gray halos — fix the asset instead.
- On a **translucent / `backdrop-blur`** container, treat `isolation: isolate` as required companion CSS,
  not optional.
- The real long-term fix is a **transparent SVG wordmark with `currentColor` ink** — theme it via
  `color`/`fill`, zero blend fragility, crisp at any DPI. Prefer that when you can re-export the asset.
- Always set intrinsic `width`/`height` on a raw `<img>` to avoid first-paint reflow (CLS), even when a
  fixed CSS height pins the vertical box (`w-auto` still reflows horizontally otherwise).

## Cross-references

- MDN [`mix-blend-mode`](https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode)
  · [`isolation`](https://developer.mozilla.org/en-US/docs/Web/CSS/isolation)
  · [`<blend-mode>`](https://developer.mozilla.org/en-US/docs/Web/CSS/blend-mode)
- Related web SSR/theming wiring: `docs/solutions/integration-issues/nextjs16-wagmi-rainbowkit-ssr-wiring.md`
- Found in PR #8 review (todo 085) + hardened during `/workflows:compound`.
