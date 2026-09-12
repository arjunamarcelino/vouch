"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Clock, Database, Activity } from "lucide-react";
import { Badge } from "@vouch/ui/components/badge";
import { cn } from "@vouch/ui/lib/utils";
import type { JobState } from "@vouch/shared/schemas";

/**
 * Small shared indicators reused across dashboard / job detail (dedup — one countdown, one state badge,
 * one freshness badge). Status is always icon + text + color (never color alone — WCAG 1.4.1).
 */

const STATE_META: Record<JobState, { label: string; variant: "default" | "success" | "warning" | "destructive" }> = {
  None: { label: "None", variant: "default" },
  Funded: { label: "Funded", variant: "default" },
  AcceptedByProvider: { label: "Accepted", variant: "default" },
  Submitted: { label: "Submitted", variant: "default" },
  InitiallyApproved: { label: "Covered", variant: "success" },
  ClaimPending: { label: "Claim pending", variant: "warning" },
  ClaimPaid: { label: "Claim paid", variant: "success" },
  Completed: { label: "Completed", variant: "success" },
  Cancelled: { label: "Cancelled", variant: "destructive" },
  Expired: { label: "Expired", variant: "destructive" },
};

export function StateBadge({ status }: { status: JobState }) {
  const meta = STATE_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function fmtRemaining(sec: number): string {
  if (sec <= 0) return "ended";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}

/** Coverage window countdown. Ticks each second, but degrades to a static value under reduced-motion. */
export function CoverageCountdown({ coverageEndSec }: { coverageEndSec: number }) {
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = coverageEndSec - nowSec;
  const ended = remaining <= 0;
  const atRisk = !ended && remaining < 3600;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm",
        ended ? "text-muted-foreground" : atRisk ? "text-warning" : "text-success",
      )}
    >
      {ended ? <ShieldAlert className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
      {ended ? "Coverage ended" : `Coverage ${fmtRemaining(remaining)}`}
    </span>
  );
}

/** Provenance badge: chain reads are authoritative/live; Graph reads carry confidence. */
export function FreshnessBadge({
  source,
  confidence,
}: {
  source: "chain" | "graph";
  confidence?: "FRESH" | "DEGRADED" | "STALE";
}) {
  if (source === "chain") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Activity className="size-3.5 text-success" aria-hidden /> Chain · authoritative
      </span>
    );
  }
  const tone = confidence === "STALE" ? "text-destructive" : confidence === "DEGRADED" ? "text-warning" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone)}>
      <Database className="size-3.5" aria-hidden /> Graph · {confidence?.toLowerCase() ?? "indexed"}
    </span>
  );
}

export { Clock };
