import { Injectable } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
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
      throw new VouchError("SUBGRAPH_UNAVAILABLE", "Agent service unreachable", err);
    }
    if (res.status === 404) throw new VouchError("VALIDATION_FAILED", "Not found");
    if (!res.ok) throw new VouchError("SUBGRAPH_UNAVAILABLE", `Agent responded ${res.status}`);
    return res.json();
  }

  private get(path: string): Promise<unknown> {
    return this.request(path);
  }

  health(): Promise<unknown> {
    return this.get("/health");
  }

  requestQuote(job: unknown): Promise<unknown> {
    return this.request("/quotes", { method: "POST", body: job });
  }

  verifyQuote(body: unknown): Promise<unknown> {
    return this.request("/quotes/verify", { method: "POST", body });
  }

  /** Fetch a quote and stamp a stale guard so a caller never acts on an expired quote (Stream D). */
  async quote(quoteId: string): Promise<unknown> {
    const q = (await this.get(`/quotes/${encodeURIComponent(quoteId)}`)) as { expiresAt?: string } | null;
    if (q && typeof q === "object") {
      const nowSec = Math.floor(Date.now() / 1000);
      const expired = q.expiresAt !== undefined && Number(q.expiresAt) <= nowSec;
      return { ...q, expired };
    }
    return q;
  }

  explanation(quoteId: string): Promise<unknown> {
    return this.get(`/traces/${encodeURIComponent(quoteId)}`);
  }

  txStatus(key: string): Promise<unknown> {
    return this.get(`/tx/${encodeURIComponent(key)}`);
  }
}
