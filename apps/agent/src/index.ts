import { createLogger } from "@vouch/shared/logger";
import { NotImplementedError, VouchError } from "@vouch/shared/errors";
import { loadEnv } from "./config/env";
import { assertSubgraphFresh, getProviderReputation } from "./graph/client";
import { quoteGuarantee } from "./risk/quote";
import { createArcClient, watchCoverageWindows } from "./monitor/watch";
import { createAgentWallet } from "./wallet/agentWallet";

const log = createLogger("agent");

/**
 * Autonomous risk-quotation & job-monitoring agent entrypoint.
 * Quotes guarantee sizes from live subgraph reputation and monitors coverage
 * windows. It NEVER settles funds (plan §17.3).
 */
async function main(): Promise<void> {
  const env = loadEnv();
  log.info({ chainEnv: env.CHAIN_ENV }, "vouch agent starting");

  // --- The Graph: live reputation → risk quote (demo of the AI use-case) ---
  if (env.SUBGRAPH_URL) {
    try {
      await assertSubgraphFresh(env.SUBGRAPH_URL);
      const sample = "0x0000000000000000000000000000000000000000";
      const reputation = await getProviderReputation(env.SUBGRAPH_URL, sample);
      if (reputation) {
        const quote = quoteGuarantee(reputation, 100_000_000n); // 100 USDC base (6-dec)
        log.info({ quote }, "risk quote produced from live subgraph data");
      } else {
        log.info({ sample }, "no reputation yet for sample provider");
      }
    } catch (err) {
      logError("subgraph risk-quote", err);
    }
  } else {
    log.warn("SUBGRAPH_URL not set — skipping risk quotation");
  }

  // --- Arc: monitor coverage windows (read-only) ---
  if (env.VOUCH_CORE_ADDRESS) {
    const client = createArcClient(env.CHAIN_ENV, env.ARC_RPC_URL);
    watchCoverageWindows(client, env.VOUCH_CORE_ADDRESS as `0x${string}`);
  } else {
    log.warn("VOUCH_CORE_ADDRESS not set — skipping onchain monitoring");
  }

  // --- Circle Agent Stack wallet (guarded placeholder; not wired yet) ---
  try {
    createAgentWallet({ apiKey: env.CIRCLE_API_KEY, entitySecret: env.CIRCLE_ENTITY_SECRET });
  } catch (err) {
    if (err instanceof NotImplementedError) {
      log.warn({ reason: err.message }, "agent wallet not configured");
    } else {
      throw err;
    }
  }
}

function logError(context: string, err: unknown): void {
  if (err instanceof VouchError) {
    log.error({ context, code: err.code, message: err.message }, "vouch error");
  } else {
    log.error({ context, err: err instanceof Error ? err.message : String(err) }, "unexpected error");
  }
}

main().catch((err: unknown) => {
  logError("main", err);
  process.exitCode = 1;
});
