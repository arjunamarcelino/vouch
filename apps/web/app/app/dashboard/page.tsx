"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@vouch/ui/components/card";
import { cn } from "@vouch/ui/lib/utils";
import { useMyJobs, useAuthMe } from "../../../lib/api/hooks";
import { bucketize } from "../../../lib/jobs";
import { JobRow } from "../../../components/jobs/JobRow";
import { JobsLoading, JobsError, JobsEmpty } from "../../../components/jobs/JobsFallbacks";
import { PageHeader } from "../../../components/app/PageHeader";

/**
 * Overview (WS-2). A high-level summary of the connected wallet's guarantees — headline counts per
 * bucket plus a short recent-activity list. The full, grouped list lives on /app/jobs (and creating a
 * job is entered from there). The gate (app/app/layout) guarantees an authed session here.
 */
export default function OverviewPage() {
  const me = useAuthMe();
  const jobs = useMyJobs(!!me.data);

  const { buckets, total, recent } = useMemo(() => {
    const all = jobs.data ?? [];
    return { buckets: bucketize(all).buckets, total: all.length, recent: all.slice(0, 5) };
  }, [jobs.data]);

  return (
    <div className="mx-auto max-w-[88rem] px-4 py-10 sm:px-6">
      <PageHeader title="Overview" subtitle="Your guarantees at a glance." />

      {/* Summary stats */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total jobs" value={total} loading={jobs.isLoading} accent />
        {buckets.map((b) => (
          <Stat key={b.key} label={b.label} value={b.items.length} loading={jobs.isLoading} />
        ))}
      </div>

      {/* Recent activity */}
      <section className="mt-10" aria-labelledby="recent-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-heading" className="font-mono text-xs uppercase tracking-[0.14em] text-subtle-foreground">
            Recent activity
          </h2>
          {total > recent.length ? (
            <Link href="/app/jobs" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          ) : null}
        </div>

        {jobs.isLoading ? (
          <JobsLoading />
        ) : jobs.isError ? (
          <JobsError />
        ) : recent.length === 0 ? (
          <JobsEmpty />
        ) : (
          <div className="space-y-2">
            {recent.map((j) => (
              <JobRow key={j.clientRequestId} job={j} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, loading, accent }: { label: string; value: number; loading?: boolean; accent?: boolean }) {
  return (
    <Card className={cn("transition-colors", accent ? "border-primary/30 bg-primary/[0.04]" : "hover:bg-muted/30")}>
      <CardContent className="p-4">
        <div className={cn("font-mono text-3xl font-medium tabular-nums", accent ? "text-primary" : "text-foreground")}>
          {loading ? "—" : value}
        </div>
        <p className="mt-1 text-xs leading-tight text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
