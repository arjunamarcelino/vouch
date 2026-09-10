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
