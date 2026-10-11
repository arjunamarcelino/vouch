"use client";

import { Cpu } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { cn } from "@vouch/ui/lib/utils";
import { useIntegrationsHealth, useTopProviders } from "../../lib/api/hooks";
import { resolveMode } from "../../lib/mode";
import { shortHex } from "../../lib/format";
import { PrizeEvidenceDrawer } from "../../components/demo/PrizeEvidenceDrawer";
import { TechStrip } from "../../components/common/TechStrip";
import { ModePill } from "../../components/common/indicators";
import { Reveal } from "../../components/home/motion";

/**
 * Judge demo (WS-7). A guided walk through the canonical 6-step flow. Each step names the integration it
 * exercises and whether that integration is LIVE (real Arc/Graph) or a clearly-labeled local simulation.
 * No fabricated transactions: the stepper narrates; the Prize Evidence drawer surfaces real provenance.
 * The Graph panel shows live indexed reputation; the before/after quote block is explicitly illustrative
 * (a real diff needs a full claim round-trip). Editorial register borrowed from the landing (Reveal
 * scroll animation, font-display headings, uppercase mono pills) — no per-step icons; steps alternate
 * their surface tint for rhythm.
 */

type Rail = "arc" | "graph" | "cre";

const STEPS: { title: string; body: string; rail: Rail }[] = [
  { title: "Client funds 20 USDC", body: "The client opens a job and escrows the task fee (+ optional service fee) on Arc.", rail: "arc" },
  { title: "Provider locks 100 USDC", body: "The provider accepts and locks a capped, self-funded guarantee as collateral.", rail: "arc" },
  { title: "Public tests pass → fee released", body: "Initial evaluation approves the work; the 20 USDC fee is released and a 24h coverage window opens.", rail: "arc" },
  { title: "Confidential regression runs", body: "A private regression test runs inside the Chainlink CRE TEE. The secret never leaves the enclave.", rail: "cre" },
  { title: "Regression proven → guarantee pays out", body: "The DON-signed verdict {jobId, covered, amount} gates the payout; the client receives the 100 USDC.", rail: "arc" },
  { title: "Verdict indexed → reputation updates", body: "The Graph indexes the verdict into the provider's on-chain performance history.", rail: "graph" },
];

function RailPill({ live, cre }: { live: boolean; cre?: boolean }) {
  if (cre) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <Cpu className="size-3.5" aria-hidden /> CRE · CLI simulation evidence
      </span>
    );
  }
  return <ModePill live={live} />;
}

/** Centered section title in the landing's display register, with an optional italic-primary accent. */
function SectionTitle({ id, eyebrow, children }: { id: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="text-center">
      <span className="font-mono text-xs uppercase tracking-[0.16em] text-subtle-foreground">{eyebrow}</span>
      <h2 id={id} className="mt-2 font-display text-2xl tracking-tight text-foreground sm:text-3xl">
        {children}
      </h2>
    </div>
  );
}

export default function DemoPage() {
  const health = useIntegrationsHealth();
  const mode = resolveMode(health.data);
  const providers = useTopProviders();
  const railLive: Record<Rail, boolean> = { arc: mode.arc, graph: mode.graph, cre: false };

  return (
    <div className="relative overflow-hidden">
      {/* Atmosphere: warm-paper wash + a soft accent glow + fading ledger grid (decorative, like the hero). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-paper" />
        <div className="absolute -right-32 -top-40 size-[34rem] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute inset-0 text-foreground/[0.1] bg-grid [mask-image:radial-gradient(110%_70%_at_70%_0%,#000_10%,transparent_70%)]" />
      </div>

      <div className="mx-auto max-w-[88rem] px-4 py-12 sm:px-6 sm:py-16">
        {/* ============================= HERO (centered) ============================= */}
        <div className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-subtle-foreground shadow-sm backdrop-blur">
            Judge demo · live walkthrough
          </span>
          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            See a Guarantee Resolve,
            <br />
            <span className="italic text-primary">End to End.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            Six steps from a funded job to a DON-signed payout. Each step names the rail it runs on and
            whether that rail is <span className="font-medium text-foreground">live on Arc testnet</span>{" "}
            or a clearly-labeled local simulation — nothing here is fabricated. The stepper narrates; the
            evidence drawer shows real provenance.
          </p>
          <div className="mt-8 flex justify-center">
            <PrizeEvidenceDrawer />
          </div>
        </div>

        {/* Stack strip (centered) — label sits above the logos */}
        <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-4 backdrop-blur">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            This demo runs on
          </span>
          <TechStrip label="" size="sm" className="justify-center" />
        </div>

        {/* ===================== NUMBERED STEPPER ===================== */}
        <section className="mt-14" aria-labelledby="flow-heading">
          <SectionTitle id="flow-heading" eyebrow="The flow">
            How a Guarantee <span className="italic text-primary">Resolves.</span>
          </SectionTitle>

          <ol className="mt-8 space-y-3">
            {STEPS.map((step, i) => {
              // Alternating surface tint gives the sequence a visible rhythm ("bergantian").
              const alt = i % 2 === 1;
              return (
                <li key={step.title}>
                  <Reveal delay={i * 80}>
                    <div
                      className={cn(
                        "flex items-start gap-4 rounded-2xl border p-5 shadow-sm transition-colors sm:p-6",
                        alt ? "border-primary/15 bg-primary/[0.045]" : "border-border bg-card",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold tabular-nums",
                          alt ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-base tracking-tight text-foreground sm:text-lg">
                            {step.title}
                          </h3>
                          <RailPill live={railLive[step.rail]} cre={step.rail === "cre"} />
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                      </div>
                    </div>
                  </Reveal>
                </li>
              );
            })}
          </ol>
        </section>

        {/* ===================== THE GRAPH RESULT ===================== */}
        <section className="mt-16" aria-labelledby="graph-heading">
          <Reveal>
            <SectionTitle id="graph-heading" eyebrow="The Graph">
              Reputation, <span className="italic text-primary">Indexed Live.</span>
            </SectionTitle>
            <div className="mt-3 flex justify-center">
              {mode.graph ? (
                <Badge variant="success" className="uppercase tracking-wide">Live</Badge>
              ) : (
                <Badge variant="warning" className="uppercase tracking-wide">Simulation</Badge>
              )}
            </div>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
              Every verdict is indexed into the provider&apos;s on-chain track record — the same data the
              risk quote reads straight from.
            </p>

            <Card className="mt-5">
              <CardContent className="p-0">
                {providers.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading indexed providers…</p>
                ) : providers.isError ? (
                  <p className="p-4 text-sm text-warning">
                    Reputation unavailable (the subgraph is unreachable or lagging) — failing closed rather
                    than showing stale history.
                  </p>
                ) : (providers.data?.length ?? 0) === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No indexed providers yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle-foreground">
                          <th className="px-4 py-2.5 font-medium">Provider</th>
                          <th className="px-4 py-2.5 font-medium tabular-nums">Completed</th>
                          <th className="px-4 py-2.5 font-medium tabular-nums">Upheld</th>
                          <th className="px-4 py-2.5 font-medium tabular-nums">Rejected</th>
                          <th className="px-4 py-2.5 font-medium tabular-nums">Upheld rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providers.data?.map((p) => {
                          const bps = Number(p.lastUpheldClaimRateBps);
                          const rate = bps < 0 ? "—" : `${(bps / 100).toFixed(1)}%`;
                          return (
                            <tr key={p.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
                              <td className="px-4 py-2.5 font-mono text-xs">{shortHex(p.id)}</td>
                              <td className="px-4 py-2.5 tabular-nums">{p.jobsCompleted}</td>
                              <td className="px-4 py-2.5 tabular-nums">{p.claimsUpheld}</td>
                              <td className="px-4 py-2.5 tabular-nums">{p.claimsRejected}</td>
                              <td className="px-4 py-2.5 tabular-nums">{rate}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </Reveal>
        </section>

        {/* ===================== BEFORE / AFTER RISK QUOTE (ILLUSTRATIVE) ===================== */}
        <section className="mt-16" aria-labelledby="quote-heading">
          <Reveal>
            <SectionTitle id="quote-heading" eyebrow="Risk pricing">
              How an Upheld Claim <span className="italic text-primary">Reprices Risk.</span>
            </SectionTitle>
            <div className="mt-3 flex justify-center">
              <Badge variant="warning" className="uppercase tracking-wide">Illustrative</Badge>
            </div>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
              The risk quote is a pure function of live indexed reputation. An upheld claim raises the
              upheld-claim-rate, which widens the premium and the recommended guarantee cap. (Values shown
              illustrate the mechanism; a live diff requires a full claim round-trip.)
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">Before the claim</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>Upheld-claim-rate: <span className="font-medium tabular-nums">0.0%</span></p>
                  <p>Premium: <span className="font-medium tabular-nums">250 bps</span></p>
                  <p>Recommended cap: <span className="font-medium tabular-nums">100 USDC</span></p>
                </CardContent>
              </Card>
              <Card className="border-primary/30 bg-primary/[0.04]">
                <CardHeader>
                  <CardTitle className="text-sm text-primary">After an upheld claim</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>Upheld-claim-rate: <span className="font-medium tabular-nums">higher</span></p>
                  <p>Premium: <span className="font-medium tabular-nums text-primary">wider</span></p>
                  <p>Recommended cap: <span className="font-medium tabular-nums">adjusted by exposure</span></p>
                </CardContent>
              </Card>
            </div>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
