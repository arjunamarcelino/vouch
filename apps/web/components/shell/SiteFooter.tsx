"use client";

import { usePathname } from "next/navigation";
import { TechStrip } from "../common/TechStrip";
import { TestnetBadge } from "../common/TestnetBadge";

/**
 * App shell footer: the "Built on" stack strip + a light legal line. Renders on every page via the root
 * layout EXCEPT the standalone auth screen (`/login`) and the gated app surface (`/app/*`), which run
 * their own chrome (a full-height sign-in and a side menu, respectively).
 */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/app" || pathname.startsWith("/app/")) return null;

  return (
    <footer className="relative mt-24 border-t border-border bg-paper">
      <div className="mx-auto flex max-w-[88rem] flex-col gap-8 px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-lg">
            <TestnetBadge />
            <p className="mt-3 font-display text-2xl leading-snug tracking-tight text-foreground sm:text-3xl">
              Confidential Outcome Assurance for Agentic Work.
            </p>
          </div>
          <TechStrip size="sm" />
        </div>

        <div className="h-px w-full bg-border" />

        <div className="flex flex-col gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Vouch</span>
          <span>Sponsor logos are property of their respective owners.</span>
        </div>
      </div>
    </footer>
  );
}
