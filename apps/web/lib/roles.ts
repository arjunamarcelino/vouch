import type { JobView, AuthMe } from "@vouch/shared/schemas";

/**
 * Client-side role/eligibility projection (plan §role pre-gating). Mirrors the API's JobParty/Roles
 * guards + lifecycle preconditions so the UI disables disallowed actions BEFORE the click — the server
 * stays authoritative (403 at prepare time is the backstop). The viewer's party is derived by comparing
 * the connected address to the job's lowercased client/provider; EVALUATOR comes from the session roles.
 * `claimResolutionDeadline` isn't in the JobView, so RESOLVE_TIMEOUT is offered in ClaimPending and the
 * API enforces the exact deadline.
 */
export type JobActionId =
  | "ACCEPT"
  | "SUBMIT"
  | "EVAL_APPROVE"
  | "EVAL_REJECT"
  | "CLAIM"
  | "CANCEL"
  | "EXPIRE"
  | "WITHDRAW"
  | "RESOLVE_TIMEOUT";

export interface JobActionAvail {
  id: JobActionId;
  label: string;
  available: boolean;
  /** Why it's unavailable (for aria + tooltip) — only set when `available` is false. */
  reason?: string;
}

export interface Viewer {
  address?: string;
  roles: string[];
}

export function viewerFromAuth(me: AuthMe | null | undefined): Viewer {
  return { address: me?.address, roles: me?.roles ?? [] };
}

export function jobActions(job: JobView, viewer: Viewer, nowSec: number): JobActionAvail[] {
  const addr = viewer.address?.toLowerCase();
  const isClient = !!addr && addr === job.client.toLowerCase();
  const isProvider = !!addr && addr === job.provider.toLowerCase();
  const isParty = isClient || isProvider;
  const isEvaluator = viewer.roles.includes("EVALUATOR");
  const coverageEnd = Number(job.coverageEnd);
  const submissionDeadline = Number(job.submissionDeadline);

  const gate = (id: JobActionId, label: string, ok: boolean, reason: string): JobActionAvail =>
    ok ? { id, label, available: true } : { id, label, available: false, reason };

  const out: JobActionAvail[] = [];

  out.push(
    gate("ACCEPT", "Accept & lock collateral", isProvider && job.status === "Funded", isProvider ? "Only available while the job is Funded" : "Only the provider can accept"),
  );
  out.push(
    gate(
      "SUBMIT",
      "Submit deliverable",
      isProvider && job.status === "AcceptedByProvider" && nowSec < submissionDeadline,
      isProvider ? "Available after accepting, before the submission deadline" : "Only the provider can submit",
    ),
  );
  out.push(gate("EVAL_APPROVE", "Approve submission", isEvaluator && job.status === "Submitted", isEvaluator ? "Available while Submitted" : "Requires the evaluator role"));
  out.push(gate("EVAL_REJECT", "Reject submission", isEvaluator && job.status === "Submitted", isEvaluator ? "Available while Submitted" : "Requires the evaluator role"));
  out.push(
    gate(
      "CLAIM",
      "Open claim",
      isClient && job.status === "InitiallyApproved" && nowSec < coverageEnd,
      !isClient ? "Only the client can open a claim" : job.status !== "InitiallyApproved" ? "A claim opens on an approved job" : "The coverage window has closed",
    ),
  );
  out.push(gate("CANCEL", "Cancel job", isClient && job.status === "Funded", isClient ? "Only before a provider accepts" : "Only the client can cancel"));
  out.push(
    gate(
      "EXPIRE",
      "Expire (deadline passed)",
      isParty && (job.status === "AcceptedByProvider" || job.status === "Submitted") && nowSec > submissionDeadline,
      !isParty ? "Only a job participant can trigger this" : "Only after the submission deadline passes",
    ),
  );
  out.push(
    gate(
      "WITHDRAW",
      "Withdraw collateral",
      isProvider && job.status === "InitiallyApproved" && nowSec >= coverageEnd,
      !isProvider ? "Only the provider can withdraw" : "Collateral unlocks when the coverage window ends",
    ),
  );
  out.push(
    gate("RESOLVE_TIMEOUT", "Resolve claim timeout", isParty && job.status === "ClaimPending", !isParty ? "Only a participant can trigger this" : "Only while a claim is pending"),
  );

  return out;
}
