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
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Vouch — home" className="flex items-center">
          {/* Vouch wordmark: black ink on an opaque white PNG. The blend modes key the background
              out against either theme so no white box shows on the zinc-50 (off-white) surface:
              light → multiply drops the white bg, keeps black ink; dark → invert (black↔white)
              then screen drops the now-black bg, keeps the white ink. Intrinsic w/h reserve the
              box (prevents first-paint reflow); h-6 w-auto scales it. */}
          <img
            src="/logos/vouch/vouch.png"
            alt="Vouch"
            width={828}
            height={285}
            className="h-6 w-auto mix-blend-multiply dark:mix-blend-screen dark:invert"
          />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-muted text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
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
