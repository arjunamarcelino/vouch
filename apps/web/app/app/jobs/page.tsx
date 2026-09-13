"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@vouch/ui/components/card";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { useMyJobs, useAuthMe } from "../../../lib/api/hooks";
import { bucketize } from "../../../lib/jobs";
import { JobRow } from "../../../components/jobs/JobRow";
import { PageHeader } from "../../../components/app/PageHeader";

/**
 * Jobs list (WS-2). The full, bucketed view of the connected wallet's jobs — role-aware, grouped by the
 * offchain cached status mirror. This is also the entry point for creating a job (the "Create job" CTA);
 * the Overview only summarizes. The gate (app/app/layout) guarantees an authed session here.
 */
export default function JobsPage() {
  const me = useAuthMe();
  const jobs = useMyJobs(!!me.data);

  const grouped = useMemo(() => {
    const { buckets, syncing } = bucketize(jobs.data ?? []);
    return { buckets: buckets.filter((b) => b.items.length > 0), syncing };
  }, [jobs.data]);

  return (
    <div className="mx-auto max-w-[88rem] px-4 py-10 sm:px-6">
      <PageHeader
        title="Jobs"
        subtitle="Every job you're a client or provider on, grouped by status."
        actions={
          <Link href="/app/jobs/new" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
            <Plus className="size-4" aria-hidden /> Create job
          </Link>
        }
      />

      {jobs.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading your jobs…</p>
      ) : jobs.isError ? (
        <Card className="mt-8">
          <CardContent className="p-6 text-sm text-warning">Couldn&apos;t load your jobs right now.</CardContent>
        </Card>
      ) : (jobs.data?.length ?? 0) === 0 ? (
        <Card className="mt-8">
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No jobs yet.{" "}
            <Link href="/app/jobs/new" className="font-medium text-primary hover:underline">
              Create one
            </Link>{" "}
            to attach a post-completion guarantee.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 space-y-8">
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
