import { z } from "zod";
import { hexAddress, baseUnits, uintString, ratioBpsString } from "./primitives";
import { jobStateSchema, claimStatusSchema } from "./api";

/**
 * Read-response ("view") schemas for the web↔api READ surface — the frozen internal contract (plan §6)
 * that `apps/web` consumes through TanStack Query. Authored to match the REAL controller/service return
 * shapes (not prose): `JobView` mirrors `jobs.controller`'s `:id` body, `ClaimStatusView`
 * `claims.service`, `IntegrationsHealth` `health.service`, `FeedItem` `feed.service`, `AllowanceView`
 * `allowance.controller`, `ProfileView` `profiles.service`, `AuthMe` `auth.controller`, and
 * `ProviderPerformance` `jobs.service`'s `providerRowSchema`.
 *
 * Primitive-only imports (from `./primitives` + the enums in `./api`) — no cycle with `./index`, which
 * re-exports this module. Money stays a 6-decimal base-unit string; timestamps are `uintString`
 * (seconds) except the DB-sourced feed `at`, which is an ISO string on the wire → coerced to `Date`.
 */

// --- GET /jobs/:id (chain-authoritative) ---
export const jobViewSchema = z.object({
  jobId: z.string(),
  source: z.literal("chain"),
  status: jobStateSchema,
  client: hexAddress,
  provider: hexAddress,
  taskFee: baseUnits,
  guaranteeAmount: baseUnits,
  serviceFee: baseUnits,
  coverageEnd: uintString,
  submissionDeadline: uintString,
});
export type JobView = z.infer<typeof jobViewSchema>;

// --- GET /jobs/mine (offchain operational mirror; cachedStatus is display-only) ---
export const myJobSchema = z.object({
  clientRequestId: z.string(),
  jobId: z.string().nullable(),
  uiTitle: z.string().nullable(),
  role: z.enum(["client", "provider"]),
  cachedStatus: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type MyJob = z.infer<typeof myJobSchema>;

// --- GET /claims/:jobId/status ---
export const claimStatusViewSchema = z.object({
  jobId: z.string(),
  status: claimStatusSchema,
  serviceCredit: baseUnits.optional(),
  evaluatedAt: uintString.optional(),
});
export type ClaimStatusView = z.infer<typeof claimStatusViewSchema>;

// --- GET /providers/:address/performance + GET /jobs/providers[] (Graph-authoritative) ---
export const providerPerformanceSchema = z.object({
  id: hexAddress,
  jobsCompleted: uintString,
  jobsInitiallyApproved: uintString,
  claimsUpheld: uintString,
  claimsRejected: uintString,
  totalPayoutAmount: baseUnits,
  activeGuaranteeAmount: baseUnits,
  lastUpheldClaimRateBps: ratioBpsString,
});
export type ProviderPerformance = z.infer<typeof providerPerformanceSchema>;

// --- GET /health/integrations ---
export const probeStatusSchema = z.enum(["up", "down", "degraded"]);
export type ProbeStatus = z.infer<typeof probeStatusSchema>;

export const probeSchema = z.object({
  name: z.string(),
  status: probeStatusSchema,
  critical: z.boolean(),
  latencyMs: z.number(),
  detail: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export type Probe = z.infer<typeof probeSchema>;

export const integrationsHealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  probes: z.array(probeSchema),
});
export type IntegrationsHealth = z.infer<typeof integrationsHealthSchema>;

// --- GET /feed (participant-scoped; `kind` stays a plain string — a display feed must not fail-closed
// on an unexpected kind; callers narrow against `feedEventKindSchema` when they care) ---
export const feedItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  jobRequestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  payload: z.unknown(),
  at: z.coerce.date(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

// --- GET /allowance ---
export const allowanceViewSchema = z.object({
  owner: hexAddress,
  spender: hexAddress,
  allowance: baseUnits,
});
export type AllowanceView = z.infer<typeof allowanceViewSchema>;

// --- GET/PUT /profiles/me ---
export const profileViewSchema = z.object({
  address: z.string(),
  displayName: z.string(),
  kind: z.string().nullable(),
});
export type ProfileView = z.infer<typeof profileViewSchema>;

// --- GET /auth/me + POST /auth/nonce|verify (web uses the cookie; `token` is ignored — never stored) ---
export const authMeSchema = z.object({
  address: hexAddress,
  roles: z.array(z.string()),
  displayName: z.string(),
});
export type AuthMe = z.infer<typeof authMeSchema>;

export const nonceSchema = z.object({ nonce: z.string().min(1) });
export type Nonce = z.infer<typeof nonceSchema>;

export const authVerifySchema = z.object({ address: hexAddress, token: z.string().optional() });
export type AuthVerify = z.infer<typeof authVerifySchema>;

// --- HTTP error envelope (VouchErrorFilter: `{ error: <code>, message }`, status carried by HTTP) ---
export const apiErrorEnvelopeSchema = z.object({ error: z.string(), message: z.string() });
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
