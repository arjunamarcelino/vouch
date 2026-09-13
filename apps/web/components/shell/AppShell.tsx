"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@vouch/ui/lib/utils";
import { WalletConnectButton } from "../wallet/ConnectButton";
import { TestnetBadge } from "../common/TestnetBadge";

/**
 * App chrome for the gated `/app/*` surface: a persistent, collapsible side menu instead of the marketing
 * navbar (hidden on these routes). Desktop (lg+) gets a full-height sticky sidebar capped at the viewport
 * height — logo + testnet centered at the top, a collapse toggle, nav, and the wallet at the foot;
 * collapsed it shrinks to icon-only. Below lg it's a compact top bar + a horizontal nav row. "Create job"
 * is NOT a nav item — it's an entry point from the Jobs page.
 */
const NAV = [
  { href: "/app/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/app/jobs", label: "Jobs", icon: Briefcase },
] as const;

const WORDMARK = (
  <img
    src="/logos/vouch/vouch.png"
    alt="Vouch"
    width={828}
    height={285}
    className="h-7 w-auto mix-blend-multiply dark:mix-blend-screen dark:invert"
  />
);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const navLinks = (compact: boolean) =>
    NAV.map((item) => {
      const on = isActive(item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={on ? "page" : undefined}
          title={compact ? item.label : undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors",
            compact ? "justify-center px-0" : "px-3",
            on ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <item.icon className="size-4 shrink-0" aria-hidden />
          {compact ? null : item.label}
        </Link>
      );
    });

  return (
    // Fill the space the parent layout gives us (screen minus the in-flow StatusBar; review 109). The
    // shell itself never scrolls — only the content region does — so the page as a whole stays put.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      {/* Desktop sidebar — full-height within the shell, collapsible to icons, scrolls internally. */}
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col overflow-y-auto border-r border-border bg-card/40 pb-6 pt-6 transition-[width] duration-200 lg:flex",
          collapsed ? "w-16 px-2" : "w-60 px-4",
        )}
      >
        {/* Logo + testnet, centered horizontally */}
        <div className="flex flex-col items-center gap-2">
          <Link href="/" aria-label="Vouch — home" className="flex items-center justify-center">
            {collapsed ? (
              <img src="/favicon.svg" alt="Vouch" className="size-7" />
            ) : (
              WORDMARK
            )}
          </Link>
          {collapsed ? null : <TestnetBadge />}
        </div>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mt-4 inline-flex items-center justify-center self-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
        </button>

        <nav className="mt-4 flex flex-col gap-1" aria-label="App">
          {navLinks(collapsed)}
        </nav>

        {collapsed ? null : (
          <div className="mt-auto px-1">
            <WalletConnectButton />
          </div>
        )}
      </aside>

      {/* Mobile top bar + nav row */}
      <div className="lg:hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-3">
          <Link href="/" aria-label="Vouch — home" className="flex items-center">
            {WORDMARK}
          </Link>
          <WalletConnectButton />
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2" aria-label="App">
          {navLinks(false)}
        </nav>
      </div>

      {/* Content — the only scrollable region. */}
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
