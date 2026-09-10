import { Injectable } from "@nestjs/common";
import { loadEnv } from "../config/env";

/**
 * Reads the authoritative reputation/financial read-model from The Graph.
 * Onchain + subgraph are authoritative; this service never writes financial state.
 */
@Injectable()
export class GraphService {
  private readonly env = loadEnv();

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.env.SUBGRAPH_URL) {
      throw new Error("SUBGRAPH_URL not configured");
    }
    const res = await fetch(this.env.SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (body.errors) throw new Error(JSON.stringify(body.errors));
    if (body.data === undefined) throw new Error("Subgraph returned no data");
    return body.data;
  }
}
