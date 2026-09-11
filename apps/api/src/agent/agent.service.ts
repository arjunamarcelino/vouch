import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ApiError } from "../common/errors";
import { parseOrThrow, quoteCommitmentSchema, decisionTraceSchema } from "@vouch/shared/schemas";
import { correlationId } from "../common/correlation/correlation";
import { loadEnv } from "../config/env";

/**
 * Thin proxy to the agent's REST core (apps/agent). The dashboard reads quotes, decision traces, and
 * tx status THROUGH the agent — the agent owns its operational tables; the API never imports its DB
 * repo (architecture P2). Propagates `x-correlation-id` for a single trace across web→api→agent and
 * presents the agent Bearer key on signing routes. Agent unreachable → SUBGRAPH_UNAVAILABLE 503.
 */
@Injectable()
export class AgentService {
  private readonly env = loadEnv();
  private readonly base = this.env.AGENT_URL.replace(/\/$/u, "");

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = { "x-correlation-id": correlationId() };
    if (json) h["content-type"] = "application/json";
    if (this.env.AGENT_API_KEY) h["authorization"] = `Bearer ${this.env.AGENT_API_KEY}`;
    return h;
  }

  private async request(path: string, init?: { method: "POST"; body: unknown }): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method: init?.method ?? "GET",
        headers: this.headers(init !== undefined),
        body: init ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      // An AGENT outage is not a SUBGRAPH outage — use the dedicated API-local code (review 071).
      throw new ApiError("AGENT_UNAVAILABLE", "Agent service unreachable", err);
    }
    if (res.status === 404) throw new ApiError("NOT_FOUND", "Not found"); // 404, not 400
    if (!res.ok) throw new ApiError("AGENT_UNAVAILABLE", `Agent responded ${res.status}`);
    return res.json();
  }

  private get(path: string): Promise<unknown> {
    return this.request(path);
  }

  health(): Promise<unknown> {
    return this.get("/health");
  }

  async requestQuote(job: unknown): Promise<unknown> {
    const q = await this.request("/quotes", { method: "POST", body: job });
    return this.withStaleGuard(q); // validate the agent's signed commitment before returning
  }

  verifyQuote(body: unknown): Promise<unknown> {
    return this.request("/quotes/verify", { method: "POST", body });
  }

  /** Fetch a quote, validate it, and stamp a fail-CLOSED stale guard (review 058). */
  async quote(quoteId: string): Promise<unknown> {
    return this.withStaleGuard(await this.get(`/quotes/${encodeURIComponent(quoteId)}`));
  }

  /**
   * Validate the agent's quote against the shared commitment schema (fail-closed: a malformed payload
   * throws VALIDATION_FAILED, never passes through), then stamp `expired`. A missing / non-numeric
   * `expiresAt` can't occur post-validation, so `expired` is honest (was fail-OPEN: `NaN <= now` → false).
   */
  private withStaleGuard(q: unknown): unknown {
    const parsed = parseOrThrow(quoteCommitmentSchema, q, "agent quote");
    const expired = Number(parsed.expiresAt) <= Math.floor(Date.now() / 1000);
    return { ...(q as object), expired };
  }

  async explanation(quoteId: string): Promise<unknown> {
    const traces = await this.get(`/traces/${encodeURIComponent(quoteId)}`);
    return parseOrThrow(z.array(decisionTraceSchema), traces, "agent decision traces");
  }

  txStatus(key: string): Promise<unknown> {
    return this.get(`/tx/${encodeURIComponent(key)}`);
  }
}
