"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { JOB_STATES, type JobState, type MyJob } from "@vouch/shared/schemas";
import { useMyJobs, useAuthMe } from "../../../lib/api/hooks";
import { StateBadge } from "../../../components/common/indicators";

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

function JobRow({ job }: { job: MyJob }) {
  const state = asJobState(job.cachedStatus);
  return (
    <Link
      href={job.jobId ? `/app/jobs/${job.jobId}` : "#"}
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
  const jobs = useMyJobs(!!me.data);

  // Bucket once per jobs change (not on every render, incl. the 30s health poll tick).
  const grouped = useMemo(() => {
    const all = jobs.data ?? [];
    const buckets = BUCKETS.map((b) => ({
      ...b,
      items: all.filter((j) => {
        const s = asJobState(j.cachedStatus);
        return s ? b.states.includes(s) : false;
      }),
    })).filter((b) => b.items.length > 0);
    const syncing = all.filter((j) => !asJobState(j.cachedStatus));
    return { buckets, syncing };
  }, [jobs.data]);

  return (
    <div className="mx-auto max-w-[88rem] px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Dashboard</h1>
        <Link href="/app/jobs/new" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
          <Plus className="size-4" aria-hidden /> Create job
        </Link>
      </div>

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
            <Link href="/app/jobs/new" className="text-primary hover:underline">
              Create one
            </Link>{" "}
            to attach a post-completion guarantee.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 space-y-6">
          {grouped.buckets.map((bucket) => (
            <section key={bucket.key} aria-labelledby={`b-${bucket.key}`}>
              <h2 id={`b-${bucket.key}`} className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-subtle-foreground">
                {bucket.label} <span className="tabular-nums">({bucket.items.length})</span>
              </h2>
              <div className="space-y-2">
                {bucket.items.map((j) => (
                  <JobRow key={j.clientRequestId} job={j} />
                ))}
              </div>
            </section>
          ))}
          {grouped.syncing.length > 0 ? (
            <section aria-labelledby="b-sync">
              <h2 id="b-sync" className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-subtle-foreground">
                Syncing <span className="tabular-nums">({grouped.syncing.length})</span>
              </h2>
              <div className="space-y-2">
                {grouped.syncing.map((j) => (
                  <JobRow key={j.clientRequestId} job={j} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
