"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@vouch/ui/lib/utils";
import { WalletConnectButton } from "../wallet/ConnectButton";

/**
 * App shell header: wordmark, primary nav, and the wallet connect button. Blue accent is reserved for
 * the active nav item (accent discipline). Sticky, zinc substrate, one hairline border.
 */
const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs/new", label: "Create job" },
  { href: "/demo", label: "Judge demo" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 isolate border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" aria-label="Vouch — home" className="flex items-center">
          {/* Vouch wordmark: black ink on an opaque white PNG. The blend modes key the background
              out against either theme so no white box shows on the zinc-50 (off-white) surface:
              light → multiply drops the white bg, keeps black ink; dark → invert (black↔white)
              then screen drops the now-black bg, keeps the white ink. `isolate` on the header is
              required: without it the blend composites against page content scrolling under this
              translucent backdrop-blur bar and the keying flickers. Intrinsic w/h reserve the box
              (prevents first-paint reflow); h-6 w-auto scales it. */}
          <img
            src="/logos/vouch/vouch.png"
            alt="Vouch"
            width={828}
            height={285}
            className="h-6 w-auto mix-blend-multiply dark:mix-blend-screen dark:invert"
          />
        </Link>
        <nav className="hidden items-center gap-7 sm:flex" aria-label="Primary">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                {/* Editorial active/hover underline that wipes in from the left. */}
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
        <div className="ml-auto">
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
