"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Cpu, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { JOB_STATES, type JobState } from "@vouch/shared/schemas";
import { useJob, useClaimStatus, useAuthMe } from "../../lib/api/hooks";
import { jobActions, viewerFromAuth, type JobActionId } from "../../lib/roles";
import { useTxEngine } from "../../lib/tx/engine";
import {
  prepareAccept,
  prepareApprove,
  prepareEvaluate,
  prepareCancel,
  prepareExpire,
  prepareWithdraw,
  prepareResolveTimeout,
  prepareSubmit,
  prepareClaim,
  fetchAllowance,
} from "../../lib/api/prepare";
import { formatUsdc, shortHex, explorerAddressLink } from "../../lib/format";
import { StateBadge, CoverageCountdown, FreshnessBadge } from "../common/indicators";
import { TxStatus } from "../tx/TxStatus";
import { ApiClientError } from "../../lib/api/client";

const HEX32 = /^0x[a-fA-F0-9]{64}$/u;
/** Happy-path lifecycle sequence shown in the timeline (terminal states rendered separately). */
const TIMELINE: JobState[] = ["Funded", "AcceptedByProvider", "Submitted", "InitiallyApproved", "ClaimPaid"];

function AddressCell({ role, address }: { role: string; address: string }) {
  const link = explorerAddressLink(address);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{role}</span>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">
          {shortHex(address)}
        </a>
      ) : (
        <span className="font-mono text-xs">{shortHex(address)}</span>
      )}
    </div>
  );
}

export function JobDetail({ id }: { id: string }) {
  const me = useAuthMe();
  const engine = useTxEngine();
  const [commitment, setCommitment] = useState("");
  const [commitFor, setCommitFor] = useState<JobActionId | null>(null);
  // The lifecycle status captured when an action was dispatched; the post-tx poll runs until the
  // authoritative chain read advances past it (the Arc read can lag the mined receipt — P2-4).
  const statusAtActionStart = useRef<JobState | null>(null);

  // After a tx settles, poll the chain read until the lifecycle genuinely advances (bounded by the
  // hook's error-stop). `pollUntil` returns true to STOP.
  const job = useJob(
    id,
    engine.flow.stage === "done"
      ? (jv) => statusAtActionStart.current === null || jv.status !== statusAtActionStart.current
      : undefined,
  );
  const claim = useClaimStatus(id, true);

  if (job.isLoading) {
    return <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-muted-foreground">Loading job…</div>;
  }
  if (job.isError) {
    const notFound = job.error instanceof ApiClientError && job.error.isNotFound;
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/dashboard" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Dashboard
        </Link>
        <Card>
          <CardContent className="p-6 text-sm">
            {notFound ? "No job found for this id." : "Couldn't load this job. The chain read may be unavailable."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const j = job.data!;
  const viewer = viewerFromAuth(me.data);
  const nowSec = Math.floor(Date.now() / 1000);
  const actions = jobActions(j, viewer, nowSec);
  const currentOrdinal = JOB_STATES.indexOf(j.status);
  const run = (id_: JobActionId) => {
    statusAtActionStart.current = j.status; // so the post-tx poll knows what "advanced" means
    const common = { jobId: id };
    switch (id_) {
      case "ACCEPT":
        return engine.run({
          ...common,
          action: "ACCEPT",
          prepare: (k) => prepareAccept(id, k),
          approval: {
            isNeeded: async () => BigInt((await fetchAllowance()).allowance) < BigInt(j.guaranteeAmount),
            prepare: (k) => prepareApprove(k, { amount: j.guaranteeAmount }),
          },
        });
      case "EVAL_APPROVE":
        return engine.run({ ...common, action: "EVAL", prepare: (k) => prepareEvaluate(id, k, true) });
      case "EVAL_REJECT":
        return engine.run({ ...common, action: "EVAL", prepare: (k) => prepareEvaluate(id, k, false) });
      case "CANCEL":
        return engine.run({ ...common, action: "CANCEL", prepare: (k) => prepareCancel(id, k) });
      case "EXPIRE":
        return engine.run({ ...common, action: "EXPIRE", prepare: (k) => prepareExpire(id, k) });
      case "WITHDRAW":
        return engine.run({ ...common, action: "WITHDRAW", prepare: (k) => prepareWithdraw(id, k) });
      case "RESOLVE_TIMEOUT":
        return engine.run({ ...common, action: "RESOLVE_TIMEOUT", prepare: (k) => prepareResolveTimeout(id, k) });
      case "SUBMIT":
        return engine.run({ ...common, action: "SUBMIT", prepare: (k) => prepareSubmit(id, k, commitment) });
      case "CLAIM":
        return engine.run({ ...common, action: "CLAIM", prepare: (k) => prepareClaim(id, k, commitment) });
    }
  };

  const needsCommitment = (a: JobActionId) => a === "SUBMIT" || a === "CLAIM";
  const commitmentValid = HEX32.test(commitment);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Dashboard
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight tabular-nums">Job #{j.jobId}</h1>
        <StateBadge status={j.status} />
        <FreshnessBadge source="chain" />
        {me.data && (viewer.address === j.client.toLowerCase() || viewer.address === j.provider.toLowerCase()) ? (
          <Badge variant="default">
            You are the {viewer.address === j.client.toLowerCase() ? "client" : "provider"}
          </Badge>
        ) : null}
      </div>

      {engine.flow.stage !== "idle" ? (
        <div className="mt-4">
          <TxStatus flow={engine.flow} onReset={engine.reset} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {/* Parties + amounts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parties &amp; amounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <AddressCell role="Client" address={j.client} />
            <AddressCell role="Provider" address={j.provider} />
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Task fee</span>
              <span className="font-medium tabular-nums">{formatUsdc(j.taskFee)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Guarantee (collateral)</span>
              <span className="font-medium tabular-nums">{formatUsdc(j.guaranteeAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Service fee</span>
              <span className="font-medium tabular-nums">{formatUsdc(j.serviceFee)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Coverage + collateral */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-primary" aria-hidden /> Coverage &amp; collateral
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {j.status === "InitiallyApproved" || j.status === "ClaimPending" ? (
              <CoverageCountdown coverageEndSec={Number(j.coverageEnd)} />
            ) : (
              <p className="text-muted-foreground">Coverage opens when the submission is approved.</p>
            )}
            <p className="text-muted-foreground">
              The provider&apos;s <span className="font-medium text-foreground tabular-nums">{formatUsdc(j.guaranteeAmount)}</span>{" "}
              collateral is locked until the coverage window ends (or a claim resolves). It can be
              withdrawn only after <span className="text-foreground">coverage ends with no covered claim</span>.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Lifecycle timeline (chain-driven) */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Lifecycle</CardTitle>
        </CardHeader>
        <CardContent>
          {j.status === "Cancelled" || j.status === "Expired" ? (
            <p className="text-sm text-destructive">Terminal: {j.status}. Escrowed funds were refunded per the exit path.</p>
          ) : (
            <ol className="space-y-2">
              {TIMELINE.map((s) => {
                const ord = JOB_STATES.indexOf(s);
                const done = currentOrdinal >= ord && currentOrdinal !== -1;
                const current = j.status === s || (s === "ClaimPaid" && j.status === "Completed");
                return (
                  <li key={s} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                        current ? "bg-primary text-primary-foreground" : done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      {done && !current ? "✓" : ""}
                    </span>
                    <span className={cn(current ? "font-medium" : done ? "text-foreground" : "text-muted-foreground")}>
                      {s === "ClaimPaid" ? "Completed / Claim paid" : s}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 text-xs text-subtle-foreground">Lifecycle state is read from Arc (authoritative); the activity feed decorates it.</p>
        </CardContent>
      </Card>

      {/* Claim & confidential evaluation */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="size-4 text-primary" aria-hidden /> Confidential evaluation &amp; claim
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {claim.isLoading ? (
            <p className="text-muted-foreground">Loading claim status…</p>
          ) : claim.isError ? (
            <p className="text-warning">Claim status unavailable right now.</p>
          ) : claim.data ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                <ClaimBadge status={claim.data.status} />
              </div>
              {claim.data.serviceCredit ? (
                <p>
                  Service credit paid: <span className="font-medium tabular-nums">{formatUsdc(claim.data.serviceCredit)}</span>
                </p>
              ) : null}
              <p className="text-xs text-subtle-foreground">
                Opening a claim triggers the Chainlink CRE confidential test off-chain; only the minimal
                verdict is published. Private criteria never reach this UI or the API.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-4 text-primary" aria-hidden /> Actions
            {me.data ? <Badge variant="success">live</Badge> : <Badge variant="warning">connect to act</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!me.data ? (
            <p className="text-sm text-muted-foreground">Connect your wallet and sign in to act on this job.</p>
          ) : null}
          {commitFor && needsCommitment(commitFor) ? (
            <div className="rounded-md border border-input p-3">
              <label htmlFor="commitment" className="text-sm font-medium">
                {commitFor === "CLAIM" ? "Evidence commitment" : "Submission commitment"} (bytes32)
              </label>
              <input
                id="commitment"
                value={commitment}
                onChange={(e) => setCommitment(e.target.value)}
                placeholder="0x…"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-describedby="commitment-help"
              />
              <p id="commitment-help" className="mt-1 text-xs text-subtle-foreground">
                Only the salted hash is submitted — raw private material never leaves your browser.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => {
              const blocked = !a.available || engine.isBusy || (needsCommitment(a.id) && commitFor === a.id && !commitmentValid);
              const onClick = () => {
                if (needsCommitment(a.id) && commitFor !== a.id) {
                  setCommitFor(a.id);
                  return;
                }
                run(a.id);
              };
              return (
                <button
                  key={a.id}
                  onClick={onClick}
                  disabled={blocked}
                  aria-disabled={blocked}
                  title={a.available ? undefined : a.reason}
                  className={cn(
                    buttonVariants({ variant: a.id === "EVAL_REJECT" || a.id === "CANCEL" ? "outline" : "default", size: "sm" }),
                    blocked && "pointer-events-none opacity-50",
                  )}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
          {actions.every((a) => !a.available) ? (
            <p className="text-sm text-muted-foreground">No actions available to you in this state.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ClaimBadge({ status }: { status: string }) {
  const variant =
    status === "COVERED_PAID" ? "success" : status === "REJECTED_CONSUMED" || status === "TIMED_OUT" ? "destructive" : status === "PENDING" ? "warning" : "default";
  return <Badge variant={variant as "success" | "destructive" | "warning" | "default"}>{status}</Badge>;
}
