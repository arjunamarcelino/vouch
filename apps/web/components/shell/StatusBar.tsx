"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Radio, CircleDot } from "lucide-react";
import { cn } from "@vouch/ui/lib/utils";
import type { Probe } from "@vouch/shared/schemas";
import { useIntegrationsHealth } from "../../lib/api/hooks";
import { resolveMode, modeLabel } from "../../lib/mode";

/**
 * App status bar (WS-2/WS-3 consolidation). A slim fixed footer chrome — shown on the gated app surface
 * (`/app/*`) and the public `/demo`, never on the marketing home / `/login` — that merges the affordances
 * used to live inside those pages: the dashboard "Integration health" strip and the create-job "live"
 * badge. Left is a single Live/Simulation indicator (derived from the dual-mode resolver); next to it a
 * "Networks"-style popover reveals the per-integration health probes. Locked (unauthenticated) resolves
 * to a muted "Local simulation" — the UI never implies a live integration it can't prove (see mode.ts).
 */

function probeTone(status: Probe["status"]): string {
  return status === "up" ? "text-success" : status === "degraded" ? "text-warning" : "text-destructive";
}

function ProbeRow({ probe }: { probe: Probe }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <CircleDot className={cn("size-3.5", probeTone(probe.status))} aria-hidden />
        {probe.name}
        {probe.critical ? <span className="text-[0.6rem] uppercase tracking-wide text-subtle-foreground">core</span> : null}
      </span>
      <span className="inline-flex items-center gap-2 text-subtle-foreground">
        {probe.error ? <span className="max-w-32 truncate text-destructive" title={probe.error}>{probe.error}</span> : null}
        <span className="tabular-nums">{Math.round(probe.latencyMs)}ms</span>
        <span className={cn("uppercase tracking-wide", probeTone(probe.status))}>{probe.status}</span>
      </span>
    </li>
  );
}

export function StatusBar() {
  const pathname = usePathname();
  const health = useIntegrationsHealth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const mode = useMemo(() => resolveMode(health.data), [health.data]);
  const probes = health.data?.probes ?? [];
  const liveCount = probes.filter((p) => p.status === "up").length;

  // Close the popover on outside click / Escape (no Popover primitive in @vouch/ui).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset the popover when navigating between app routes.
  useEffect(() => setOpen(false), [pathname]);

  const loading = health.isLoading;
  const live = mode.isLive;
  const statusLabel = loading ? "Connecting…" : modeLabel(live);
  const dotTone = loading ? "bg-muted-foreground" : live ? "bg-success" : "bg-warning-fill";

  return (
    <>
      {/* Spacer so the fixed bar never covers page content / the footer's last line. */}
      <div aria-hidden className="h-11" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
        <div ref={rootRef} className="mx-auto flex h-11 max-w-[88rem] items-center gap-4 px-4 sm:px-6">
          {/* Live / simulation indicator */}
          <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
            <span className="relative flex size-2">
              {live && !loading ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60 motion-reduce:hidden" />
              ) : null}
              <span className={cn("relative inline-flex size-2 rounded-full", dotTone)} />
            </span>
            {statusLabel}
          </span>

          <span aria-hidden className="h-4 w-px bg-border" />

          {/* Networks / integration-health popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Radio className="size-3.5" aria-hidden />
              Networks
              {probes.length ? (
                <span className="tabular-nums text-subtle-foreground">
                  {liveCount}/{probes.length}
                </span>
              ) : null}
            </button>

            {open ? (
              <div
                role="dialog"
                aria-label="Integration health"
                className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-border bg-card p-3 shadow-lg"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Integration health</span>
                  <span className={cn("text-[0.65rem] font-medium uppercase tracking-wide", live ? "text-success" : "text-warning")}>
                    {loading ? "checking" : live ? "all systems live" : "degraded"}
                  </span>
                </div>
                {loading ? (
                  <p className="py-2 text-xs text-muted-foreground">Checking readiness…</p>
                ) : probes.length ? (
                  <ul className="divide-y divide-border">
                    {probes.map((p) => (
                      <ProbeRow key={p.name} probe={p} />
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-xs text-muted-foreground">
                    Sign in to view live readiness · running local simulation.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
