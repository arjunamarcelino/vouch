"use client";

import {
  Lock,
  HandCoins,
  FileCheck2,
  Cpu,
  ShieldCheck,
  Network,
  CircleCheck,
  CircleSlash,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { cn } from "@vouch/ui/lib/utils";
import { useIntegrationsHealth, useTopProviders } from "../../lib/api/hooks";
import { resolveMode, modeLabel } from "../../lib/mode";
import { shortHex } from "../../lib/format";
import { PrizeEvidenceDrawer } from "../../components/demo/PrizeEvidenceDrawer";
import { TechStrip } from "../../components/common/TechStrip";
import { ModePill } from "../../components/common/indicators";

/**
 * Judge demo (WS-7). A guided, numbered walk through the canonical 6-step flow. Each step is labeled
 * with the integration it exercises and whether that integration is LIVE (real Arc/Graph) or running as
 * a clearly-labeled local simulation. No fabricated transactions: the stepper narrates; the Prize
 * Evidence drawer surfaces real provenance. The Graph panel shows live indexed reputation; the
 * before/after quote block is explicitly labeled illustrative (a real diff needs a full claim round-trip).
 */

type Rail = "arc" | "graph" | "cre";

const STEPS: { icon: typeof Lock; title: string; body: string; rail: Rail }[] = [
  { icon: HandCoins, title: "Client funds 20 USDC", body: "The client opens a job and escrows the task fee (+ optional service fee) on Arc.", rail: "arc" },
  { icon: Lock, title: "Provider locks 100 USDC", body: "The provider accepts and locks a capped, self-funded guarantee as collateral.", rail: "arc" },
  { icon: FileCheck2, title: "Public tests pass → fee released", body: "Initial evaluation approves the work; the 20 USDC fee is released and a 24h coverage window opens.", rail: "arc" },
  { icon: Cpu, title: "Confidential regression runs", body: "A private regression test runs inside the Chainlink CRE TEE. The secret never leaves the enclave.", rail: "cre" },
  { icon: ShieldCheck, title: "Regression proven → guarantee pays out", body: "The DON-signed verdict {jobId, covered, amount} gates the payout; the client receives the 100 USDC.", rail: "arc" },
  { icon: Network, title: "Verdict indexed → reputation updates", body: "The Graph indexes the verdict into the provider's on-chain performance history.", rail: "graph" },
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

export default function DemoPage() {
  const health = useIntegrationsHealth();
  const mode = resolveMode(health.data);
  const providers = useTopProviders();
  const railLive: Record<Rail, boolean> = { arc: mode.arc, graph: mode.graph, cre: false };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Judge demo</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Watch a guarantee resolve end-to-end. Every step is labeled with the rail it exercises and
            whether that rail is live on testnet or a local simulation — nothing is fabricated.
          </p>
        </div>
        <PrizeEvidenceDrawer />
      </div>

      {/* Stack strip */}
      <div className="mt-6 rounded-lg border border-border bg-muted/20 px-4 py-3">
        <TechStrip label="This demo runs on" size="sm" />
      </div>

      {/* Mode banner */}
      <div
        className={cn(
          "mt-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm",
          mode.isLive ? "border-success/30 bg-success/5 text-success" : "border-border bg-muted/40 text-muted-foreground",
        )}
        role="status"
      >
        {mode.isLive ? <CircleCheck className="size-4" aria-hidden /> : <CircleSlash className="size-4" aria-hidden />}
        <span className="font-medium">{modeLabel(mode.isLive)}</span>
        <span className="text-muted-foreground">
          {mode.isLive
            ? "Arc RPC and the subgraph are reachable — data below is live indexed state."
            : health.isLoading
              ? "Checking integration health…"
              : "Some integrations aren't configured — showing a clearly-labeled local simulation."}
        </span>
      </div>

      {/* Numbered stepper */}
      <ol className="mt-8 space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card>
              <div className="flex items-start gap-4 p-4">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                  {i + 1}
                </span>
                <step.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{step.title}</h2>
                    <RailPill live={railLive[step.rail]} cre={step.rail === "cre"} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      {/* The Graph result */}
      <section className="mt-10" aria-labelledby="graph-heading">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-primary" aria-hidden />
          <h2 id="graph-heading" className="text-sm font-semibold">
            The Graph — live indexed reputation
          </h2>
          {mode.graph ? (
            <Badge variant="success">live</Badge>
          ) : (
            <Badge variant="warning">simulation</Badge>
          )}
        </div>
        <Card className="mt-3">
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
                      <th className="px-4 py-2 font-medium">Provider</th>
                      <th className="px-4 py-2 font-medium tabular-nums">Completed</th>
                      <th className="px-4 py-2 font-medium tabular-nums">Upheld</th>
                      <th className="px-4 py-2 font-medium tabular-nums">Rejected</th>
                      <th className="px-4 py-2 font-medium tabular-nums">Upheld rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.data?.map((p) => {
                      const bps = Number(p.lastUpheldClaimRateBps);
                      const rate = bps < 0 ? "—" : `${(bps / 100).toFixed(1)}%`;
                      return (
                        <tr key={p.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2 font-mono text-xs">{shortHex(p.id)}</td>
                          <td className="px-4 py-2 tabular-nums">{p.jobsCompleted}</td>
                          <td className="px-4 py-2 tabular-nums">{p.claimsUpheld}</td>
                          <td className="px-4 py-2 tabular-nums">{p.claimsRejected}</td>
                          <td className="px-4 py-2 tabular-nums">{rate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Before / after risk quote (illustrative) */}
      <section className="mt-10" aria-labelledby="quote-heading">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" aria-hidden />
          <h2 id="quote-heading" className="text-sm font-semibold">
            How an upheld claim reprices risk
          </h2>
          <Badge variant="warning">illustrative</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          The risk quote is a pure function of live indexed reputation. An upheld claim raises the
          upheld-claim-rate, which widens the premium and the recommended guarantee cap. (Values shown
          illustrate the mechanism; a live diff requires a full claim round-trip.)
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Before the claim</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Upheld-claim-rate: <span className="tabular-nums font-medium">0.0%</span></p>
              <p>Premium: <span className="tabular-nums font-medium">250 bps</span></p>
              <p>Recommended cap: <span className="tabular-nums font-medium">100 USDC</span></p>
            </CardContent>
          </Card>
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="text-sm text-primary">After an upheld claim</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Upheld-claim-rate: <span className="tabular-nums font-medium">higher</span></p>
              <p>Premium: <span className="tabular-nums font-medium text-primary">wider</span></p>
              <p>Recommended cap: <span className="tabular-nums font-medium">adjusted by exposure</span></p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
