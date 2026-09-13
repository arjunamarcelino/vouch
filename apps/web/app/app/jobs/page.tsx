"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { APP_CONTAINER } from "../../../lib/layout";
import { useMyJobs, useAuthMe } from "../../../lib/api/hooks";
import { bucketize } from "../../../lib/jobs";
import { JobRow } from "../../../components/jobs/JobRow";
import { JobsLoading, JobsError, JobsEmpty } from "../../../components/jobs/JobsFallbacks";
import { PageHeader } from "../../../components/app/PageHeader";

/**
 * Jobs list (WS-2). The full, bucketed view of the connected wallet's jobs — role-aware, grouped by the
 * offchain cached status mirror. This is also the entry point for creating a job (the "Create job" CTA);
 * the Overview only summarizes. The gate (app/app/layout) guarantees an authed session here.
 */
export default function JobsPage() {
  const me = useAuthMe();
  const jobs = useMyJobs(!!me.data);

  // Non-empty buckets, with "syncing" appended as a pseudo-bucket so everything renders in one map (113).
  const sections = useMemo(() => {
    const { buckets, syncing } = bucketize(jobs.data ?? []);
    const shown = buckets.filter((b) => b.items.length > 0);
    if (syncing.length > 0) shown.push({ key: "sync", label: "Syncing", states: [], items: syncing });
    return shown;
  }, [jobs.data]);

  return (
    <div className={APP_CONTAINER}>
      <PageHeader
        title="Jobs"
        subtitle="Every job you're a client or provider on, grouped by status."
        actions={
          <Link href="/app/jobs/new" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
            <Plus className="size-4" aria-hidden /> Create job
          </Link>
        }
      />

      <div className="mt-8">
        {jobs.isLoading ? (
          <JobsLoading />
        ) : jobs.isError ? (
          <JobsError />
        ) : (jobs.data?.length ?? 0) === 0 ? (
          <JobsEmpty />
        ) : (
          <div className="space-y-8">
            {sections.map((bucket) => (
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
          </div>
        )}
      </div>
    </div>
  );
}
