"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { TestnetBadge } from "../common/TestnetBadge";
import { Wordmark } from "../common/Wordmark";
import { HOME_NAV } from "../../lib/home-sections";

/**
 * Marketing header: a floating pill (asyah-style), mounted only by the (marketing) route group.
 *   - Landing ("/"): centered nav = in-page section anchors; right = Demo + Open App.
 *   - Demo ("/demo"): no centered nav (no in-page sections); right = Demo + Open App.
 * No wallet/product nav here — the gated app renders those via AppShell. The sticky <header> supplies
 * only the floating inset; `isolate` keys the wordmark blend against the pill's own backdrop.
 */

export function SiteHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  // Marketing-only header (review 107/108): it is mounted solely by the (marketing) route group, i.e.
  // only on `/` and `/demo`. The landing carries the in-page section nav; the demo has none.
  const nav = isHome ? HOME_NAV : [];

  // Scroll-spy: on the landing, highlight whichever section has scrolled past the nav line. The active
  // item is the last section whose top sits above the offset (nav height + a little), so it flips exactly
  // as each section reaches the pill.
  const [activeHash, setActiveHash] = useState("#top");
  useEffect(() => {
    if (!isHome) return;
    const ids = HOME_NAV.map((n) => n.href.slice(1));
    let rafId = 0;
    let ticking = false;
    const measure = () => {
      ticking = false;
      // Slightly past where headings land (scroll-mt-32 = 128px) so a clicked section reads as active.
      const offset = 140;
      let current = ids[0] ?? "top";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) current = id;
      }
      setActiveHash(`#${current}`);
    };
    // Coalesce scroll/resize into one measurement per frame — the layout reads (getBoundingClientRect)
    // must not run per-event, or they force a reflow storm on every scroll tick.
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [isHome]);

  return (
    <header className="sticky top-0 z-30 px-4 pt-3 sm:px-6 sm:pt-4">
      <div className="relative isolate mx-auto flex h-[4.5rem] max-w-[88rem] items-center justify-between gap-4 rounded-2xl border border-border bg-surface/80 px-4 shadow-lg shadow-black/[0.04] backdrop-blur-md supports-[backdrop-filter]:bg-surface/65 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Link href="/" aria-label="Vouch — home" className="flex items-center">
            <Wordmark />
          </Link>
          <TestnetBadge />
        </div>

        {nav.length > 0 ? (
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 sm:flex" aria-label="Primary">
          {nav.map((item) => {
            const active = isHome
              ? item.href === activeHash
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative rounded-sm py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {/* Active/hover underline that wipes in from the left. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute -bottom-0.5 left-0 h-px w-full origin-left bg-primary transition-transform duration-300",
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                  )}
                />
              </Link>
            );
          })}
        </nav>
        ) : null}

        <div className="flex items-center gap-2">
          <Link href="/demo" className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}>
            Demo
          </Link>
          <Link href="/app/dashboard" className={cn(buttonVariants(), "group gap-1.5")}>
            Open App
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}
