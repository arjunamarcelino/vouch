"use client";

import { Fragment, useRef, useState } from "react";
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
  fetchAllowance,
} from "../../lib/api/prepare";
import { formatUsdc, shortHex, explorerAddressLink, isHash32, gteUsdc } from "../../lib/format";
import { StateBadge, CoverageCountdown, FreshnessBadge, ClaimBadge } from "../common/indicators";
import { TxStatus } from "../tx/TxStatus";
import { ApiClientError } from "../../lib/api/client";

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

/** Lifecycle step dot color: current (primary), completed (success), or upcoming (muted). */
function stepDotCls(st: { done: boolean; current: boolean }): string {
  return st.current
    ? "bg-primary text-primary-foreground"
    : st.done
      ? "bg-success text-success-foreground"
      : "bg-muted text-muted-foreground";
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
    return <div className="mx-auto max-w-[88rem] px-4 py-10 text-sm text-muted-foreground">Loading job…</div>;
  }
  if (job.isError) {
    const notFound = job.error instanceof ApiClientError && job.error.isNotFound;
    return (
      <div className="mx-auto max-w-[88rem] px-4 py-10">
        <Link href="/app/jobs" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Back to jobs
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
  const available = actions.filter((a) => a.available); // only render actions the viewer can actually take
  const currentOrdinal = JOB_STATES.indexOf(j.status);
  const steps = TIMELINE.map((s) => {
    const ord = JOB_STATES.indexOf(s);
    // `ClaimPaid` is the resolution step: alias both `Completed` (paid & closed) and `ClaimPending`
    // (claim open, being resolved) onto it so an active pending claim shows a current marker (review 111).
    const isResolutionStep = s === "ClaimPaid";
    return {
      s,
      label: isResolutionStep ? "Completed / Claim paid" : s,
      done: currentOrdinal >= ord && currentOrdinal !== -1,
      current: j.status === s || (isResolutionStep && (j.status === "Completed" || j.status === "ClaimPending")),
    };
  });
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
            isNeeded: async () => !gteUsdc((await fetchAllowance()).allowance, j.guaranteeAmount),
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
    }
  };

  // SUBMIT takes a commitment inline; CLAIM routes to the dedicated /claim page (which hashes evidence
  // from plain text) rather than asking the user to paste a bytes32 here.
  const needsCommitment = (a: JobActionId) => a === "SUBMIT";
  const commitmentValid = isHash32(commitment);

  return (
    <div className="mx-auto max-w-[88rem] px-4 py-10 sm:px-6">
      <Link href="/app/jobs" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back to jobs
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl tracking-tight tabular-nums sm:text-4xl">Job #{j.jobId}</h1>
        <StateBadge status={j.status} />
        <FreshnessBadge source="chain" />
        {me.data && (viewer.address === j.client.toLowerCase() || viewer.address === j.provider.toLowerCase()) ? (
          <Badge variant="default" className="uppercase tracking-wide">
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
            <>
              {/* Mobile / tablet: vertical stepper */}
              <ol className="space-y-2 lg:hidden">
                {steps.map((st, i) => (
                  <li key={st.s} className="flex items-center gap-3 text-sm">
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", stepDotCls(st))} aria-hidden>
                      {st.done && !st.current ? "✓" : i + 1}
                    </span>
                    <span className={cn(st.current ? "font-medium" : st.done ? "text-foreground" : "text-muted-foreground")}>
                      {st.label}
                    </span>
                  </li>
                ))}
              </ol>

              {/* Large desktop: horizontal stepper with connectors */}
              <ol className="hidden items-start lg:flex">
                {steps.map((st, i) => {
                  const isLast = i === steps.length - 1;
                  return (
                    <Fragment key={st.s}>
                      <li className="flex w-28 shrink-0 flex-col items-center gap-2 text-center">
                        <span className={cn("flex size-6 items-center justify-center rounded-full text-xs font-semibold", stepDotCls(st))} aria-hidden>
                          {st.done && !st.current ? "✓" : i + 1}
                        </span>
                        <span className={cn("text-xs leading-tight", st.current ? "font-medium text-foreground" : st.done ? "text-foreground" : "text-muted-foreground")}>
                          {st.label}
                        </span>
                      </li>
                      {!isLast ? (
                        <span className={cn("mt-3 h-0.5 flex-1 rounded", steps[i + 1]?.done ? "bg-success" : "bg-border")} aria-hidden />
                      ) : null}
                    </Fragment>
                  );
                })}
              </ol>
            </>
          )}
          <p className="mt-4 text-xs text-subtle-foreground">Lifecycle state is read from Arc (authoritative); the activity feed decorates it.</p>
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

      {/* Actions — only what the viewer can actually do in this state is shown. */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-4 text-primary" aria-hidden /> Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {commitFor && needsCommitment(commitFor) && available.some((a) => a.id === commitFor) ? (
            <div className="rounded-lg border border-input p-3">
              <label htmlFor="commitment" className="text-sm font-medium">
                Submission commitment (bytes32)
              </label>
              <input
                id="commitment"
                value={commitment}
                onChange={(e) => setCommitment(e.target.value)}
                placeholder="0x…"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-describedby="commitment-help"
              />
              <p id="commitment-help" className="mt-1 text-xs text-subtle-foreground">
                Only the salted hash is submitted — raw private material never leaves your browser.
              </p>
            </div>
          ) : null}

          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actions available to you in this state.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((a) => {
                // CLAIM routes to the dedicated claim page (evidence hashed there), not an inline tx.
                if (a.id === "CLAIM") {
                  return (
                    <Link key={a.id} href={`/app/jobs/${id}/claim`} className={buttonVariants({ size: "sm" })}>
                      {a.label}
                    </Link>
                  );
                }
                const blocked = engine.isBusy || (needsCommitment(a.id) && commitFor === a.id && !commitmentValid);
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
