"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Cpu, Loader2, CheckCircle2, XCircle, Clock, FileLock2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@vouch/ui/components/card";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { computeCommitment, randomSalt } from "@vouch/shared/commitment";
import type { ClaimStatus } from "@vouch/shared/schemas";
import { useJob, useClaimStatus, useAuthMe, useIntegrationsHealth } from "../../lib/api/hooks";
import { resolveMode } from "../../lib/mode";
import { useTxEngine } from "../../lib/tx/engine";
import { prepareClaim, prepareResolveTimeout } from "../../lib/api/prepare";
import { formatUsdc } from "../../lib/format";
import { StateBadge, CoverageCountdown } from "../common/indicators";
import { TxStatus } from "../tx/TxStatus";

/**
 * Claim flow (WS-6). Eligibility is gated (client-only, InitiallyApproved, within coverage) with an
 * explicit reason when blocked. The evidence is hashed to a bytes32 commitment CLIENT-SIDE — raw
 * evidence never reaches the API. Opening the claim triggers the Chainlink CRE confidential test
 * off-chain; we poll the minimal public verdict and show a payout only on a confirmed COVERED_PAID.
 */
const CRE_STEPS: { key: ClaimStatus; label: string }[] = [
  { key: "PENDING", label: "Confidential evaluation running in the CRE enclave" },
  { key: "COVERED_PAID", label: "Covered failure proven — guarantee paid" },
];

export function ClaimFlow({ id }: { id: string }) {
  const me = useAuthMe();
  const health = useIntegrationsHealth();
  const mode = resolveMode(health.data);
  const engine = useTxEngine();
  const job = useJob(id);
  const claim = useClaimStatus(id, true);
  const [evidence, setEvidence] = useState("");

  if (job.isLoading) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">Loading…</div>;
  if (job.isError || !job.data) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">Couldn&apos;t load this job.</div>;
  }

  const j = job.data;
  const addr = me.data?.address?.toLowerCase();
  const isClient = !!addr && addr === j.client.toLowerCase();
  const isParty = isClient || (!!addr && addr === j.provider.toLowerCase());
  const nowSec = Math.floor(Date.now() / 1000);
  const coverageOpen = nowSec < Number(j.coverageEnd);
  const eligible = isClient && j.status === "InitiallyApproved" && coverageOpen;
  const status = claim.data?.status ?? "NONE";

  const ineligibleReason = !me.data
    ? "Connect and sign in to file a claim."
    : !isClient
      ? "Only the job's client can open a claim."
      : j.status !== "InitiallyApproved"
        ? `A claim can only be opened on an approved job (this job is ${j.status}).`
        : !coverageOpen
          ? "The coverage window has closed."
          : null;

  function openClaim() {
    const salt = randomSalt();
    const commitment = computeCommitment(evidence, salt);
    if (typeof window !== "undefined") window.localStorage.setItem(`vouch:evidence-salt:${commitment}`, salt);
    void engine.run({ action: "CLAIM", jobId: id, simulate: !mode.arc, prepare: (k) => prepareClaim(id, k, commitment) });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href={`/jobs/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Job #{id}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">File a claim</h1>
        <StateBadge status={j.status} />
        {j.status === "InitiallyApproved" ? <CoverageCountdown coverageEndSec={Number(j.coverageEnd)} /> : null}
      </div>

      {engine.flow.stage !== "idle" ? (
        <div className="mt-4"><TxStatus flow={engine.flow} onReset={engine.reset} /></div>
      ) : null}

      {/* Evidence + eligibility */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FileLock2 className="size-4 text-primary" aria-hidden /> Evidence commitment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ineligibleReason && status === "NONE" ? (
            <p className="text-sm text-muted-foreground">{ineligibleReason}</p>
          ) : null}
          {eligible && status === "NONE" ? (
            <>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Describe the covered failure</span>
                <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
                <span className="block text-xs text-subtle-foreground">Hashed in your browser to a bytes32 commitment; the raw text never leaves this device.</span>
              </label>
              <button onClick={openClaim} disabled={engine.isBusy || evidence.trim().length === 0} className={cn(buttonVariants(), (engine.isBusy || evidence.trim().length === 0) && "pointer-events-none opacity-50")}>
                Open claim
              </button>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* CRE progress + verdict */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Cpu className="size-4 text-primary" aria-hidden /> Confidential evaluation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {status === "NONE" ? (
            <p className="text-muted-foreground">No claim opened yet. Opening a claim triggers the CRE confidential regression test.</p>
          ) : status === "PENDING" ? (
            <p className="flex items-center gap-2 text-warning"><Loader2 className="size-4 animate-spin" aria-hidden /> {CRE_STEPS[0]!.label}…</p>
          ) : status === "COVERED_PAID" ? (
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-success"><CheckCircle2 className="size-4" aria-hidden /> Covered failure proven — guarantee paid.</p>
              {claim.data?.serviceCredit ? <p>Service credit: <span className="font-medium tabular-nums">{formatUsdc(claim.data.serviceCredit)}</span></p> : null}
            </div>
          ) : status === "REJECTED_CONSUMED" ? (
            <p className="flex items-center gap-2 text-destructive"><XCircle className="size-4" aria-hidden /> Claim rejected — coverage consumed. The confidential test did not prove a covered failure.</p>
          ) : status === "TIMED_OUT" ? (
            <p className="flex items-center gap-2 text-destructive"><Clock className="size-4" aria-hidden /> Claim timed out — no verdict arrived within the grace period.</p>
          ) : null}

          {status === "PENDING" && isParty ? (
            <button
              onClick={() => void engine.run({ action: "RESOLVE_TIMEOUT", jobId: id, simulate: !mode.arc, prepare: (k) => prepareResolveTimeout(id, k) })}
              disabled={engine.isBusy}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), engine.isBusy && "pointer-events-none opacity-50")}
              title="Permissionless fallback once the resolution deadline passes (the contract enforces timing)"
            >
              Resolve timeout (fallback)
            </button>
          ) : null}
          <p className="text-xs text-subtle-foreground">Only the minimal verdict is published on-chain. Private tests and criteria stay inside the enclave.</p>
        </CardContent>
      </Card>
    </div>
  );
}
