"use client";

import Link from "next/link";
import { Plus, Activity, CircleDot } from "lucide-react";
import { Card, CardContent } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { JOB_STATES, type JobState, type MyJob, type Probe } from "@vouch/shared/schemas";
import { useMyJobs, useAuthMe, useIntegrationsHealth } from "../../lib/api/hooks";
import { StateBadge } from "../../components/common/indicators";

/**
 * Jobs dashboard (WS-2). Role-aware: one list that adapts per the connected wallet's per-job role. Jobs
 * are bucketed by the offchain cached status mirror (display-only — the authoritative lifecycle lives on
 * chain and is shown on the job detail page). The integration-health strip is always visible. Per-bucket
 * rendering is isolated so one empty/failing bucket never blanks the page.
 */
const BUCKETS: { key: string; label: string; states: JobState[] }[] = [
  { key: "active", label: "Active jobs", states: ["Funded", "AcceptedByProvider", "Submitted"] },
  { key: "coverage", label: "Under coverage", states: ["InitiallyApproved"] },
  { key: "claims", label: "Pending claims", states: ["ClaimPending"] },
  { key: "settled", label: "Settled payouts", states: ["ClaimPaid", "Completed"] },
  { key: "closed", label: "Closed", states: ["Cancelled", "Expired"] },
];

function asJobState(s: string | null): JobState | null {
  return s && (JOB_STATES as readonly string[]).includes(s) ? (s as JobState) : null;
}

function HealthDot({ probe }: { probe: Probe }) {
  const tone = probe.status === "up" ? "text-success" : probe.status === "degraded" ? "text-warning" : "text-destructive";
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={probe.error ?? probe.status}>
      <CircleDot className={cn("size-3.5", tone)} aria-hidden />
      {probe.name}
    </span>
  );
}

function JobRow({ job }: { job: MyJob }) {
  const state = asJobState(job.cachedStatus);
  return (
    <Link
      href={job.jobId ? `/jobs/${job.jobId}` : "#"}
      className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{job.uiTitle ?? `Job ${job.jobId ?? job.clientRequestId.slice(0, 8)}`}</p>
        <p className="text-xs text-muted-foreground">
          {job.jobId ? `#${job.jobId}` : "awaiting chain id"} · you are the {job.role}
        </p>
      </div>
      {state ? <StateBadge status={state} /> : <Badge variant="default">{job.cachedStatus ?? "syncing"}</Badge>}
    </Link>
  );
}

export default function DashboardPage() {
  const me = useAuthMe();
  const health = useIntegrationsHealth();
  const jobs = useMyJobs(!!me.data);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Link href="/jobs/new" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
          <Plus className="size-4" aria-hidden /> Create job
        </Link>
      </div>

      {/* Integration health strip */}
      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center gap-4 p-3">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-subtle-foreground">
            <Activity className="size-3.5" aria-hidden /> Integration health
          </span>
          {health.isLoading ? (
            <span className="text-xs text-muted-foreground">checking…</span>
          ) : health.data ? (
            health.data.probes.map((p) => <HealthDot key={p.name} probe={p} />)
          ) : (
            <span className="text-xs text-muted-foreground">Sign in to view readiness · running local simulation</span>
          )}
        </CardContent>
      </Card>

      {!me.data ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-muted-foreground">
            Connect your wallet and sign in to see your jobs. Or{" "}
            <Link href="/demo" className="text-primary hover:underline">
              open the judge demo
            </Link>
            .
          </CardContent>
        </Card>
      ) : jobs.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading your jobs…</p>
      ) : jobs.isError ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-warning">Couldn&apos;t load your jobs right now.</CardContent>
        </Card>
      ) : (jobs.data?.length ?? 0) === 0 ? (
        <Card className="mt-6">
          <CardContent className="p-6 text-sm text-muted-foreground">
            No jobs yet.{" "}
            <Link href="/jobs/new" className="text-primary hover:underline">
              Create one
            </Link>{" "}
            to attach a post-completion guarantee.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 space-y-6">
          {BUCKETS.map((bucket) => {
            const items = (jobs.data ?? []).filter((j) => {
              const s = asJobState(j.cachedStatus);
              return s ? bucket.states.includes(s) : false;
            });
            if (items.length === 0) return null;
            return (
              <section key={bucket.key} aria-labelledby={`b-${bucket.key}`}>
                <h2 id={`b-${bucket.key}`} className="mb-2 text-sm font-medium uppercase tracking-wide text-subtle-foreground">
                  {bucket.label} <span className="tabular-nums">({items.length})</span>
                </h2>
                <div className="space-y-2">
                  {items.map((j) => (
                    <JobRow key={j.clientRequestId} job={j} />
                  ))}
                </div>
              </section>
            );
          })}
          {(() => {
            const syncing = (jobs.data ?? []).filter((j) => !asJobState(j.cachedStatus));
            if (syncing.length === 0) return null;
            return (
              <section aria-labelledby="b-sync">
                <h2 id="b-sync" className="mb-2 text-sm font-medium uppercase tracking-wide text-subtle-foreground">
                  Syncing <span className="tabular-nums">({syncing.length})</span>
                </h2>
                <div className="space-y-2">
                  {syncing.map((j) => (
                    <JobRow key={j.clientRequestId} job={j} />
                  ))}
                </div>
              </section>
            );
          })()}
        </div>
      )}
    </div>
  );
}
