import { createPublicClient, http, type PublicClient } from "viem";
import { chainForEnv, type ChainEnv } from "@vouch/shared/chains";
import { assuranceHubAbi } from "@vouch/shared/abis";
import { createLogger } from "@vouch/shared/logger";

const log = createLogger("agent:monitor");

/**
 * Job-monitoring: watch AssuranceHub coverage windows / lifecycle events on Arc.
 * Read-only observation — the agent NEVER settles funds (settlement is the DON-signed
 * CRE path; the agent is transport/observer only — plan §17.3).
 */
export function createArcClient(env: ChainEnv, rpcUrl: string | undefined): PublicClient {
  const chain = chainForEnv(env);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/**
 * Scope (finding 015): intentionally watches only `CoverageStarted` — the signal the risk agent
 * acts on (a new coverage window opened). It is read-only and never settles funds (§17.3). Extend
 * with `ClaimOpened`/coverage-expiry watchers if the agent's role grows.
 */
export function watchCoverageWindows(
  client: PublicClient,
  assuranceHubAddress: `0x${string}`,
): () => void {
  log.info({ assuranceHubAddress }, "watching AssuranceHub coverage lifecycle");
  return client.watchContractEvent({
    address: assuranceHubAddress,
    abi: assuranceHubAbi,
    eventName: "CoverageStarted",
    onLogs: (logs) => {
      for (const entry of logs) {
        log.info({ args: entry.args }, "CoverageStarted");
      }
    },
    onError: (err) => log.error({ err: err.message }, "watch error"),
  });
}

/** A decoded job-lifecycle event the orchestrator reacts to. */
export interface JobEvent {
  name: "JobCreated" | "JobFunded";
  jobId: bigint;
  provider?: `0x${string}`;
  blockNumber: bigint | null;
}

/**
 * Watch job-open events (`JobCreated` / `JobFunded`) so the agent can autonomously initiate the next
 * allowed action (e.g. release the quote bond once the quote it backed is honored by an opened job).
 * Read-only observation; the handler decides the action. Reorg-safety: the handler must gate any
 * fund-moving step on finality (Arc has sub-second deterministic finality; §0.5 M2).
 */
export function watchJobEvents(
  client: PublicClient,
  assuranceHubAddress: `0x${string}`,
  onEvent: (e: JobEvent) => void,
): () => void {
  log.info({ assuranceHubAddress }, "watching AssuranceHub job-open events");
  return client.watchContractEvent({
    address: assuranceHubAddress,
    abi: assuranceHubAbi,
    onLogs: (logs) => {
      for (const entry of logs) {
        if (entry.eventName !== "JobCreated" && entry.eventName !== "JobFunded") continue;
        const args = entry.args as { jobId?: bigint; provider?: `0x${string}` };
        if (args.jobId === undefined) continue;
        onEvent({
          name: entry.eventName,
          jobId: args.jobId,
          provider: args.provider,
          blockNumber: entry.blockNumber,
        });
      }
    },
    onError: (err) => log.error({ err: err.message }, "job-event watch error"),
  });
}
