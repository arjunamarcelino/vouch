import Link from "next/link";
import { Badge } from "@vouch/ui/components/badge";
import type { MyJob } from "@vouch/shared/schemas";
import { StateBadge } from "../common/indicators";
import { asJobState } from "../../lib/jobs";

/** One tappable job row (title + id/role + status badge), linking to the job detail. Shared by the
 * Overview's recent list and the full Jobs list so both read identically. */
export function JobRow({ job }: { job: MyJob }) {
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
