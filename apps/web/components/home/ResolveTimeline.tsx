"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@vouch/ui/lib/utils";

/**
 * "How a guarantee resolves" — an OKX-style stage timeline (ref: okx.ai "How Work Gets Done").
 * The rail shows stage TITLES only; a detail panel below swaps to the active stage. It auto-advances
 * on a dwell timer (with a progress bar telegraphing the next step), pauses while the reader hovers,
 * and every node is clickable. Client component — the only interactive island on an otherwise static
 * landing. Each stage maps to a real on-chain moment in the guarantee lifecycle; blue stays the single
 * reserved accent (active node, filled connector, party/meta highlights).
 */

type Stage = {
  key: string;
  label: string;
  parties: string[];
  detail: string;
  meta: { k: string; v: string }[];
};

const STAGES: Stage[] = [
  {
    key: "fund",
    label: "Fund & lock",
    parties: ["Client", "Provider"],
    detail: "The client funds the task fee; the provider locks a capped, self-funded guarantee as collateral.",
    meta: [
      { k: "Collateral", v: "100 USDC" },
      { k: "Settles on", v: "Arc" },
    ],
  },
  {
    key: "accept",
    label: "Tests pass",
    parties: ["Client"],
    detail: "The public suite passes on delivery, so the task fee is released to the provider.",
    meta: [
      { k: "Fee released", v: "20 USDC" },
      { k: "Signal", v: "Public tests" },
    ],
  },
  {
    key: "coverage",
    label: "Coverage opens",
    parties: ["Provider"],
    detail: "A post-acceptance coverage window opens; a confidential regression test runs privately inside a TEE.",
    meta: [
      { k: "Window", v: "24h" },
      { k: "Runs in", v: "TEE" },
    ],
  },
  {
    key: "proof",
    label: "Confidential proof",
    parties: ["Chainlink CRE"],
    detail: "If the private test proves a covered failure, the DON returns a signed verdict — the sole payout gate.",
    meta: [
      { k: "Verifier", v: "Chainlink CRE" },
      { k: "Gate", v: "DON-signed" },
    ],
  },
  {
    key: "payout",
    label: "Pay out",
    parties: ["Client", "Provider"],
    detail: "The client is paid the capped guarantee, and the outcome is written to the provider's on-chain reputation.",
    meta: [
      { k: "Payout", v: "100 USDC" },
      { k: "Written to", v: "Reputation" },
    ],
  },
];

const DWELL_MS = 4800;
const N = STAGES.length;

export function ResolveTimeline() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Dwell timer, keyed on `active` so both auto-advance and manual selection restart a full dwell.
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => setActive((i) => (i + 1) % N), DWELL_MS);
    return () => clearTimeout(id);
  }, [active, paused]);

  // Keep the active node centered *within the rail only* when it overflows (mobile horizontal scroll).
  // NB: element.scrollIntoView() bubbles to every scrollable ancestor including the window, which on
  // desktop (no rail overflow) scrolls the whole page sideways. Scroll the rail container directly so
  // the page never shifts; scrollBy clamps to a no-op when there is nothing to scroll.
  useEffect(() => {
    const rail = railRef.current;
    const node = nodeRefs.current[active];
    if (!rail || !node) return;
    const railBox = rail.getBoundingClientRect();
    const nodeBox = node.getBoundingClientRect();
    const delta = nodeBox.left + nodeBox.width / 2 - (railBox.left + railBox.width / 2);
    rail.scrollBy({ left: delta, behavior: "smooth" });
  }, [active]);

  const stage = STAGES[active];
  if (!stage) return null;
  // Node centers sit at (i + 0.5)/N; fill the connector up to the active node's center.
  const fillPct = ((active + 0.5) / N) * 100;

  return (
    <div
      className="mt-12"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Rail */}
      <div
        ref={railRef}
        className="overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative min-w-[560px]">
          {/* track + filled connector */}
          <div aria-hidden className="absolute inset-x-0 top-[9px] h-px bg-border" />
          <div
            aria-hidden
            className="absolute left-0 top-[9px] h-px bg-gradient-to-r from-primary/60 to-primary transition-[width] duration-500 ease-out"
            style={{ width: `${fillPct}%` }}
          />

          <ol className="relative flex">
            {STAGES.map((s, i) => {
              const isActive = i === active;
              const isDone = i < active;
              return (
                <li key={s.key} className="flex flex-1 justify-center">
                  <button
                    ref={(el) => {
                      nodeRefs.current[i] = el;
                    }}
                    type="button"
                    onClick={() => setActive(i)}
                    aria-current={isActive ? "step" : undefined}
                    className="group flex flex-col items-center gap-3 px-2 focus-visible:outline-none"
                  >
                    <span className="relative flex size-[18px] items-center justify-center">
                      {isActive && (
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40" />
                      )}
                      <span
                        className={cn(
                          "relative size-2.5 rounded-full transition-all",
                          isActive
                            ? "bg-primary shadow-[0_0_0_4px] shadow-primary/15"
                            : isDone
                              ? "bg-primary/70"
                              : "border border-input bg-card group-hover:border-primary/50",
                        )}
                      />
                    </span>
                    <span
                      className={cn(
                        "whitespace-nowrap font-mono text-[0.72rem] uppercase tracking-[0.12em] transition-colors",
                        isActive
                          ? "font-medium text-foreground"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      {s.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* Detail panel */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="grid gap-6 sm:grid-cols-[1.5fr_1fr] sm:gap-10">
          <div>
            <div className="flex flex-wrap gap-1.5">
              {stage.parties.map((p) => (
                <span
                  key={p}
                  className="rounded-md border border-primary/25 bg-primary/[0.06] px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide text-primary"
                >
                  {p}
                </span>
              ))}
            </div>
            <h3 className="mt-4 font-mono text-lg font-semibold uppercase tracking-[0.06em] text-foreground">
              {stage.label}
            </h3>
            <p className="mt-3 flex gap-2 font-mono text-sm leading-relaxed text-muted-foreground">
              <span className="select-none text-primary" aria-hidden>
                &gt;
              </span>
              <span key={stage.key} className="fade-in">
                {stage.detail}
              </span>
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:border-l sm:border-border sm:pl-10">
            {stage.meta.map((m) => (
              <div key={m.k}>
                <dt className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-subtle-foreground">
                  {m.k}
                </dt>
                <dd className="mt-1 whitespace-nowrap font-mono text-sm text-foreground">
                  <span className="text-muted-foreground/60">[</span> {m.v}{" "}
                  <span className="text-muted-foreground/60">]</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
