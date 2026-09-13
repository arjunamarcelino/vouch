import { JOB_STATES, type JobState, type MyJob } from "@vouch/shared/schemas";

/**
 * Shared job-bucketing for the app surface (Overview + Jobs). Jobs are grouped by the offchain cached
 * status mirror (display-only — the authoritative lifecycle lives on chain and is shown on the job detail
 * page). Kept in one place so the Overview counts and the Jobs list never drift apart.
 */
export const BUCKETS: { key: string; label: string; states: JobState[] }[] = [
  { key: "active", label: "Active jobs", states: ["Funded", "AcceptedByProvider", "Submitted"] },
  { key: "coverage", label: "Under coverage", states: ["InitiallyApproved"] },
  { key: "claims", label: "Pending claims", states: ["ClaimPending"] },
  { key: "settled", label: "Settled payouts", states: ["ClaimPaid", "Completed"] },
  { key: "closed", label: "Closed", states: ["Cancelled", "Expired"] },
];

export function asJobState(s: string | null): JobState | null {
  return s && (JOB_STATES as readonly string[]).includes(s) ? (s as JobState) : null;
}

/** Split a job list into the display buckets (all buckets, callers filter empties) plus a "syncing" set
 * for jobs whose cached status isn't a known on-chain state yet. */
export function bucketize(jobs: MyJob[]) {
  const buckets = BUCKETS.map((b) => ({
    ...b,
    items: jobs.filter((j) => {
      const s = asJobState(j.cachedStatus);
      return s ? b.states.includes(s) : false;
    }),
  }));
  const syncing = jobs.filter((j) => !asJobState(j.cachedStatus));
  return { buckets, syncing };
}
