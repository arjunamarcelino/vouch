import { createPublicClient, http, type PublicClient } from "viem";
import { chainForEnv, type ChainEnv } from "@vouch/shared/chains";
import { vouchCoreAbi } from "@vouch/shared/abis";
import { createLogger } from "@vouch/shared/logger";

const log = createLogger("agent:monitor");

/**
 * Job-monitoring: watch VouchCore coverage windows / lifecycle events on Arc.
 * Read-only observation — the agent NEVER settles funds (settlement is the
 * DON-signed CRE path; agent is transport/observer only — plan §17.3).
 */
export function createArcClient(env: ChainEnv, rpcUrl: string | undefined): PublicClient {
  const chain = chainForEnv(env);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function watchCoverageWindows(
  client: PublicClient,
  vouchCoreAddress: `0x${string}`,
): () => void {
  log.info({ vouchCoreAddress }, "watching VouchCore coverage lifecycle");
  return client.watchContractEvent({
    address: vouchCoreAddress,
    abi: vouchCoreAbi,
    eventName: "CoverageOpened",
    onLogs: (logs) => {
      for (const entry of logs) {
        log.info({ args: entry.args }, "CoverageOpened");
      }
    },
    onError: (err) => log.error({ err: err.message }, "watch error"),
  });
}
