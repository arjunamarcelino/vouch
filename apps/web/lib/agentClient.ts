import {
  quoteCommitmentSchema,
  decisionTraceSchema,
  paymentIntentSchema,
  parseOrThrow,
  type QuoteCommitment,
  type DecisionTrace,
  type PaymentIntent,
} from "@vouch/shared/schemas";
import { z } from "zod";

/**
 * Typed client for the agent's dashboard read surface, proxied by apps/api (`/agent/*`). Uses the
 * shared zod schemas as the single source of truth (plan §9.2) — the dashboard renders quotes, the
 * hash-chained decision log, and payment-intent/tx status without re-declaring shapes.
 */

const agentHealthSchema = z.object({ subgraphOk: z.boolean(), walletConfigured: z.boolean() });
export type AgentHealth = z.infer<typeof agentHealthSchema>;

async function getJson(baseUrl: string, path: string): Promise<unknown> {
  const res = await fetch(`${baseUrl.replace(/\/$/u, "")}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`agent read ${path} failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentHealth(apiBase: string): Promise<AgentHealth> {
  return parseOrThrow(agentHealthSchema, await getJson(apiBase, "/agent/health"), "agent health");
}

export async function fetchQuote(apiBase: string, quoteId: string): Promise<QuoteCommitment> {
  return parseOrThrow(quoteCommitmentSchema, await getJson(apiBase, `/agent/quotes/${quoteId}`), "quote");
}

export async function fetchDecisionTrace(apiBase: string, quoteId: string): Promise<DecisionTrace[]> {
  const raw = await getJson(apiBase, `/agent/quotes/${quoteId}/trace`);
  return parseOrThrow(z.array(decisionTraceSchema), raw, "decision trace");
}

export async function fetchTxStatus(apiBase: string, idempotencyKey: string): Promise<PaymentIntent> {
  return parseOrThrow(paymentIntentSchema, await getJson(apiBase, `/agent/tx/${idempotencyKey}`), "tx status");
}
