import { z } from "zod";
import { hexAddress, baseUnits, uintString, hex32 } from "@vouch/shared/schemas";

/**
 * Request bodies for the prepare endpoints (api-internal; they reference api-only fields like uiTitle,
 * so they live here rather than in the web↔api shared contracts). `.strict()` everywhere — the secrets
 * boundary is an allowlist; a preimage/credential-shaped extra field is rejected outright.
 */

export const approveInputSchema = z.object({ amount: baseUnits }).strict();
export type ApproveInput = z.infer<typeof approveInputSchema>;

export const openJobInputSchema = z
  .object({
    provider: hexAddress,
    taskFee: baseUnits,
    guaranteeAmount: baseUnits,
    serviceFee: baseUnits,
    submissionDeadline: uintString, // unix seconds
    coverageDuration: uintString, // seconds
    publicCriteriaHash: hex32,
    privateCriteriaCommitment: hex32, // COMMITMENT only — never a preimage
    uiTitle: z.string().max(200).default(""),
    repoRef: z.string().max(200).optional(), // opaque handle; never a URL/credential
  })
  .strict();
export type OpenJobInput = z.infer<typeof openJobInputSchema>;

export const submitDeliverableInputSchema = z.object({ submissionCommitment: hex32 }).strict();
export type SubmitDeliverableInput = z.infer<typeof submitDeliverableInputSchema>;

export const resolveEvaluationInputSchema = z.object({ approved: z.boolean() }).strict();
export type ResolveEvaluationInput = z.infer<typeof resolveEvaluationInputSchema>;
