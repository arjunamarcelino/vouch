import { Injectable } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import { loadEnv } from "../config/env";

/**
 * Thin proxy to the agent's REST core (apps/agent). The dashboard reads quotes, decision traces, and
 * tx status THROUGH the agent — the agent owns its operational tables; the API never imports its DB
 * repo (architecture P2). Agent unreachable → SUBGRAPH_UNAVAILABLE-style 503 (mapped by the filter).
 */
@Injectable()
export class AgentService {
  private readonly base = loadEnv().AGENT_URL.replace(/\/$/u, "");

  private async get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`);
    } catch (err) {
      throw new VouchError("SUBGRAPH_UNAVAILABLE", "Agent service unreachable", err);
    }
    if (res.status === 404) throw new VouchError("VALIDATION_FAILED", "Not found");
    if (!res.ok) throw new VouchError("SUBGRAPH_UNAVAILABLE", `Agent responded ${res.status}`);
    return res.json();
  }

  health(): Promise<unknown> {
    return this.get("/health");
  }
  quote(quoteId: string): Promise<unknown> {
    return this.get(`/quotes/${encodeURIComponent(quoteId)}`);
  }
  trace(quoteId: string): Promise<unknown> {
    return this.get(`/traces/${encodeURIComponent(quoteId)}`);
  }
  txStatus(key: string): Promise<unknown> {
    return this.get(`/tx/${encodeURIComponent(key)}`);
  }
}
