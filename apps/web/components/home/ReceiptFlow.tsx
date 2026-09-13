"use client";

import { useEffect, useState } from "react";
import { cn } from "@vouch/ui/lib/utils";

/**
 * Worked-example receipt: a vertical settlement flow with mono figures. A single row highlight walks
 * DOWN the ledger on a fixed schedule (01 → 06, then loops) to dramatize the flow — auto-play, not
 * hover. Freezes on the last-settled row under prefers-reduced-motion.
 */
const ROWS = [
  { t: "Client funds task fee", v: "+20.00", tone: "neutral" as const },
  { t: "Provider locks guarantee", v: "+100.00", tone: "neutral" as const },
  { t: "Public tests pass → fee released", v: "−20.00", tone: "good" as const },
  { t: "24h confidential coverage opens", v: "TEE", tone: "muted" as const },
  { t: "Regression proves covered failure", v: "PROOF", tone: "muted" as const },
  { t: "Guarantee paid to client", v: "→100.00", tone: "pay" as const },
];
const STEP_MS = 1100;

export function ReceiptFlow() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((i) => (i + 1) % ROWS.length), STEP_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-subtle-foreground">
          Settlement ledger
        </span>
        <span className="font-mono text-xs text-subtle-foreground">Arc · USDC</span>
      </div>
      <ol className="divide-y divide-border">
        {ROWS.map((r, i) => {
          const on = i === active;
          return (
            <li
              key={r.t}
              className={cn(
                "flex items-center gap-4 px-5 py-3.5 transition-all duration-500",
                on && "bg-primary/[0.08] shadow-[inset_3px_0_0_var(--color-primary)]",
              )}
            >
              <span
                className={cn(
                  "font-mono text-xs tabular-nums transition-colors duration-500",
                  on ? "text-primary" : "text-muted-foreground/60",
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 text-sm text-foreground">{r.t}</span>
              <span
                className={cn(
                  "font-mono text-sm tabular-nums",
                  r.tone === "good" && "text-success-text",
                  r.tone === "pay" && "font-semibold text-primary",
                  r.tone === "neutral" && "text-foreground",
                  r.tone === "muted" && "text-[0.7rem] uppercase tracking-wide text-subtle-foreground",
                )}
              >
                {r.v}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between border-t border-border bg-primary/[0.04] px-5 py-3.5">
        <span className="font-mono text-xs uppercase tracking-[0.12em] text-primary">Client made whole</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-primary">100.00 USDC</span>
      </div>
    </div>
  );
}
