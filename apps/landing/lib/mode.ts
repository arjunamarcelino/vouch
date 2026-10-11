import type { IntegrationsHealth, Probe } from "@vouch/shared/schemas";

/**
 * Dual-mode resolver (plan §Dual-mode). Derives, from the `/health/integrations` probe report, whether
 * each prize integration is actually LIVE (configured + reachable) or should render as clearly-labeled
 * "local simulation". A datum is live only when its probe `status === "up"`; anything else (down,
 * degraded, missing, or no health at all because unauthenticated) is treated as not-live so the UI
 * never implies a real integration it can't prove. This is the single source the explorer-link
 * chokepoint and the Prize Evidence drawer consult.
 */
export type IntegrationKey = "arc" | "graph" | "agent";

const PROBE_NAME: Record<IntegrationKey, string> = {
  arc: "arc-rpc",
  graph: "subgraph",
  agent: "agent",
};

export interface ModeState {
  /** True when every CRITICAL integration (Arc + subgraph) is up — the demo can run against real data. */
  isLive: boolean;
  arc: boolean;
  graph: boolean;
  agent: boolean;
  /** The raw probe for a given integration, for detail panels (latency, last block, error category). */
  probe: (key: IntegrationKey) => Probe | undefined;
}

export function resolveMode(health: IntegrationsHealth | null | undefined): ModeState {
  const byName = new Map<string, Probe>((health?.probes ?? []).map((p) => [p.name, p]));
  const up = (key: IntegrationKey) => byName.get(PROBE_NAME[key])?.status === "up";
  const arc = up("arc");
  const graph = up("graph");
  return {
    arc,
    graph,
    agent: up("agent"),
    isLive: arc && graph,
    probe: (key) => byName.get(PROBE_NAME[key]),
  };
}

/** Label a datum's provenance for the UI ("Live on Arc testnet" vs "Local simulation"). */
export function modeLabel(isLive: boolean): string {
  return isLive ? "Live · Arc testnet" : "Local simulation";
}
