import { Injectable } from "@nestjs/common";
import { prisma } from "@vouch/db";
import { createLogger } from "@vouch/shared/logger";
import { ChainService } from "../common/chain/chain.service";
import { GraphService } from "../graph/graph.service";
import { withTimeout } from "../common/retry";
import { loadEnv } from "../config/env";

/**
 * Hand-rolled integration-health aggregator (no @nestjs/terminus dependency — simplicity review). Each
 * probe is individually bounded (Promise-race timeout) and run concurrently (allSettled), so one slow
 * downstream can't stretch the probe. Liveness is a pure process check; readiness returns 503 when any
 * CRITICAL integration is down (fail-closed). Surfaces per-integration latency + status.
 */

export type ProbeStatus = "up" | "down" | "degraded";
export interface Probe {
  name: string;
  status: ProbeStatus;
  critical: boolean;
  latencyMs: number;
  detail?: Record<string, unknown>;
  error?: string;
}
export interface IntegrationsHealth {
  status: "ok" | "degraded";
  probes: Probe[];
}

const log = createLogger("api:health");

/** Reduce a probe error to a coarse, non-sensitive category (never the raw message/URL — review 055). */
export function sanitizeProbeError(message: string): string {
  if (/timeout|timed out|ETIMEDOUT|AbortError/i.test(message)) return "timeout";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|unreachable|connect/i.test(message)) return "unreachable";
  if (/\b(4\d\d|5\d\d)\b/.test(message)) return "unhealthy";
  return "error";
}

@Injectable()
export class HealthService {
  private readonly env = loadEnv();
  private readonly probeTimeoutMs = 3_000;

  constructor(
    private readonly chain: ChainService,
    private readonly graph: GraphService,
  ) {}

  /** Liveness — process is up. No downstream calls (so an orchestrator won't kill us on a slow dep). */
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  async integrations(): Promise<IntegrationsHealth> {
    const probes = await Promise.all([
      this.probe("db", true, async () => {
        await prisma.$queryRaw`SELECT 1`;
        return {};
      }),
      this.probe("arc-rpc", true, async () => {
        const block = await this.chain.getBlockNumber();
        return { latestBlock: block.toString(), chainId: this.chain.chainId };
      }),
      this.probe("subgraph", true, async () => {
        const f = await this.graph.health();
        return {
          dataConfidence: f.dataConfidence,
          latestIndexedBlock: f.latestIndexedBlock.toString(),
          lagBlocks: f.lagBlocks.toString(),
        };
      }),
      this.probe("agent", false, async () => {
        const res = await fetch(`${this.env.AGENT_URL.replace(/\/$/u, "")}/health`);
        if (!res.ok) throw new Error(`agent responded ${res.status}`);
        return {};
      }),
    ]);
    const anyCriticalDown = probes.some((p) => p.critical && p.status === "down");
    return { status: anyCriticalDown ? "degraded" : "ok", probes };
  }

  private async probe(
    name: string,
    critical: boolean,
    fn: () => Promise<Record<string, unknown>>,
  ): Promise<Probe> {
    const start = Date.now();
    try {
      const detail = await withTimeout(fn, this.probeTimeoutMs);
      return { name, status: "up", critical, latencyMs: Date.now() - start, detail };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ probe: name, err: message }, "health probe failed"); // full detail server-side only
      return {
        name,
        status: critical ? "down" : "degraded",
        critical,
        latencyMs: Date.now() - start,
        // Coarse category ONLY — never the raw message/URL (a keyed RPC/subgraph URL would leak; review 055).
        error: sanitizeProbeError(message),
      };
    }
  }
}
