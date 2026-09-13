"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { WalletConnectButton } from "../wallet/ConnectButton";
import { TestnetBadge } from "../common/TestnetBadge";

/**
 * App shell header: a floating pill (asyah-style). Context-aware:
 *   - Landing ("/"): centered nav = in-page section anchors; right = Demo + Open App. No wallet here —
 *     the marketing page stays a public, no-connect surface.
 *   - App pages: centered nav = product routes (Dashboard / Create job); right = Demo + Connect Wallet.
 *     Create-job and the wallet only surface once you're inside the app.
 * The sticky <header> supplies only the floating inset; the inner pill is the blurred, bordered surface.
 * `isolate` keys the wordmark blend against the pill's own backdrop, not scrolled page content.
 */
const HOME_NAV = [
  { href: "#top", label: "Home" },
  { href: "#compare-heading", label: "Compare" },
  { href: "#how-heading", label: "How It Works" },
  { href: "#example-heading", label: "Example" },
  { href: "#arch-heading", label: "Rails" },
];
const APP_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs/new", label: "Create job" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const nav = isHome ? HOME_NAV : APP_NAV;

  // Scroll-spy: on the landing, highlight whichever section has scrolled past the nav line. The active
  // item is the last section whose top sits above the offset (nav height + a little), so it flips exactly
  // as each section reaches the pill.
  const [activeHash, setActiveHash] = useState("#top");
  useEffect(() => {
    if (!isHome) return;
    const ids = HOME_NAV.map((n) => n.href.slice(1));
    const onScroll = () => {
      // Slightly past where headings land (scroll-mt-32 = 128px) so a clicked section reads as active.
      const offset = 140;
      let current = ids[0]!;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) current = id;
      }
      setActiveHash(`#${current}`);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [isHome]);

  return (
    <header className="sticky top-0 z-30 px-4 pt-3 sm:px-6 sm:pt-4">
      <div className="relative isolate mx-auto flex h-[4.5rem] max-w-[88rem] items-center justify-between gap-4 rounded-2xl border border-border bg-surface/80 px-4 shadow-lg shadow-black/[0.04] backdrop-blur-md supports-[backdrop-filter]:bg-surface/65 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Link href="/" aria-label="Vouch — home" className="flex items-center">
            {/* Vouch wordmark: black ink on an opaque white PNG. Blend modes key the white bg out against
              either theme (light → multiply keeps black ink; dark → invert+screen keeps white ink). The
              pill's `isolate` composites the blend against its own backdrop, not scrolled content.
              Intrinsic w/h reserve the box (no first-paint reflow); h-7 w-auto scales it. */}
            <img
              src="/logos/vouch/vouch.png"
              alt="Vouch"
              width={828}
              height={285}
              className="h-7 w-auto mix-blend-multiply dark:mix-blend-screen dark:invert"
            />
          </Link>
          <TestnetBadge />
        </div>

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

        <div className="flex items-center gap-2">
          {isHome ? (
            <>
              <Link href="/demo" className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}>
                Demo
              </Link>
              <Link href="/dashboard" className={cn(buttonVariants(), "group gap-1.5")}>
                Open App
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </>
          ) : (
            <>
              <Link href="/demo" className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}>
                Demo
              </Link>
              <WalletConnectButton />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
