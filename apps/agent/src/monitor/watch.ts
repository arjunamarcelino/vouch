import { createPublicClient, http, type PublicClient } from "viem";
import { chainForEnv, type ChainEnv } from "@vouch/shared/chains";
import { assuranceHubAbi } from "@vouch/shared/abis";
import { createLogger } from "@vouch/shared/logger";

const log = createLogger("agent:monitor");

/**
 * Job-monitoring: watch AssuranceHub job-open events on Arc. Read-only observation — the agent NEVER
 * settles funds (settlement is the DON-signed CRE path; the agent is transport/observer only — §17.3).
 */
export function createArcClient(env: ChainEnv, rpcUrl: string | undefined): PublicClient {
  const chain = chainForEnv(env);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/** A decoded job-lifecycle event the orchestrator reacts to. */
export interface JobEvent {
  name: "JobCreated" | "JobFunded";
  jobId: bigint;
  provider?: `0x${string}`;
  blockNumber: bigint | null;
}

const JOB_EVENT_NAMES = ["JobCreated", "JobFunded"] as const;

/**
 * Watch job-open events (`JobCreated` / `JobFunded`) so the agent can autonomously react to a job
 * opening on one of its quotes. Registers ONE NARROWED watcher per event name so the RPC log filter
 * does the work (rather than pulling every AssuranceHub event and discarding — review 044/perf #4).
 * Read-only; the handler decides the action and must gate any fund-moving step on finality (§0.5 M2).
 */
export function watchJobEvents(
  client: PublicClient,
  assuranceHubAddress: `0x${string}`,
  onEvent: (e: JobEvent) => void,
): () => void {
  log.info({ assuranceHubAddress }, "watching AssuranceHub job-open events");
  const unwatchers = JOB_EVENT_NAMES.map((eventName) =>
    client.watchContractEvent({
      address: assuranceHubAddress,
      abi: assuranceHubAbi,
      eventName,
      onLogs: (logs) => {
        for (const entry of logs) {
          const args = entry.args as { jobId?: bigint; provider?: `0x${string}` };
          if (args.jobId === undefined) continue;
          onEvent({ name: eventName, jobId: args.jobId, provider: args.provider, blockNumber: entry.blockNumber });
        }
      },
      onError: (err) => log.error({ eventName, err: err.message }, "job-event watch error"),
    }),
  );
  return () => unwatchers.forEach((u) => u());
}
