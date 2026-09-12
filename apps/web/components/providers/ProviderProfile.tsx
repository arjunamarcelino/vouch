"use client";

import Link from "next/link";
import { ArrowLeft, Briefcase, ShieldCheck, ShieldX, Coins, Gauge } from "lucide-react";
import { Card, CardContent } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { useProviderPerformance } from "../../lib/api/hooks";
import { formatUsdc, shortHex, explorerAddressLink } from "../../lib/format";
import { FreshnessBadge } from "../common/indicators";

/**
 * Provider profile (WS-5). Live reputation via The Graph (fail-closed: the API 503s on a stale/lagging
 * index rather than serving stale history, surfaced here as an error state). A provider with no indexed
 * history gets a documented conservative default, not a fabricated record. Every number carries its
 * Graph provenance.
 */
function riskTier(bps: number): { label: string; variant: "success" | "warning" | "destructive" | "default" } {
  if (bps < 0) return { label: "New · unrated", variant: "default" };
  if (bps < 500) return { label: "Low risk", variant: "success" };
  if (bps < 2000) return { label: "Moderate risk", variant: "warning" };
  return { label: "Elevated risk", variant: "destructive" };
}

function Tile({ icon: Icon, label, value, sub }: { icon: typeof Briefcase; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className="mt-0.5 size-5 text-primary" aria-hidden />
        <div>
          <p className="text-xs uppercase tracking-wide text-subtle-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
          {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProviderProfile({ address }: { address: string }) {
  const perf = useProviderPerformance(address);
  const link = explorerAddressLink(address);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Dashboard
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Provider</h1>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-primary hover:underline">
            {shortHex(address, 10, 8)}
          </a>
        ) : (
          <span className="font-mono text-sm">{shortHex(address, 10, 8)}</span>
        )}
        <FreshnessBadge source="graph" />
      </div>

      {perf.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading indexed reputation…</p>
      ) : perf.isError ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-warning">
            Reputation is unavailable right now — the subgraph is unreachable or lagging. Failing closed
            rather than showing stale history.
          </CardContent>
        </Card>
      ) : !perf.data ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-muted-foreground">
            No indexed activity yet for this provider. New providers get a documented conservative risk
            tier until on-chain history accrues — not a fabricated record.
          </CardContent>
        </Card>
      ) : (
        (() => {
          const p = perf.data;
          const bps = Number(p.lastUpheldClaimRateBps);
          const tier = riskTier(bps);
          const upheld = Number(p.claimsUpheld);
          const rejected = Number(p.claimsRejected);
          const totalClaims = upheld + rejected;
          const upholdRate = totalClaims > 0 ? `${((upheld / totalClaims) * 100).toFixed(0)}%` : "—";
          return (
            <>
              <div className="mt-5 flex items-center gap-2">
                <Gauge className="size-4 text-primary" aria-hidden />
                <span className="text-sm text-muted-foreground">Current risk tier:</span>
                <Badge variant={tier.variant}>{tier.label}</Badge>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {bps < 0 ? "" : `· upheld-claim-rate ${(bps / 100).toFixed(1)}%`}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Tile icon={Briefcase} label="Jobs completed" value={p.jobsCompleted} sub={`${p.jobsInitiallyApproved} approved`} />
                <Tile icon={ShieldCheck} label="Claims upheld" value={p.claimsUpheld} sub={`${upholdRate} of resolved claims`} />
                <Tile icon={ShieldX} label="Claims rejected" value={p.claimsRejected} />
                <Tile icon={Coins} label="Total paid out" value={formatUsdc(p.totalPayoutAmount)} />
                <Tile icon={ShieldCheck} label="Active guarantees" value={formatUsdc(p.activeGuaranteeAmount)} sub="Covered value in force" />
              </div>
              <p className="mt-4 text-xs text-subtle-foreground">
                All figures are derived by The Graph from on-chain events and are the load-bearing input
                to the agent&apos;s risk quote. A lagging index fails closed above rather than serving
                stale numbers.
              </p>
            </>
          );
        })()
      )}
    </div>
  );
}
