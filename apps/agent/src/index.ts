import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { createLogger } from "@vouch/shared/logger";
import { NotImplementedError, VouchError } from "@vouch/shared/errors";
import { assertFresh, type FreshnessConfig } from "@vouch/shared/graph";
import { loadEnv, type AgentEnv } from "./config/env";
import { getProviderRisk } from "./graph/client";
import { createAgentWallet, type AgentWallet } from "./wallet/agentWallet";
import { makeSpendPolicy } from "./wallet/policy";
import { PaymentExecutor } from "./pay/executor";
import { PrismaAgentStore } from "./store/prismaStore";
import { AgentCore } from "./server/core";
import { createRestServer } from "./server/rest";
import { createArcClient, watchJobEvents } from "./monitor/watch";
import { Orchestrator } from "./orchestrator";

const log = createLogger("agent");

/** Stable non-zero EIP-712 verifyingContract when no escrow is deployed yet (§0.3 M1). */
const FALLBACK_VERIFYING_CONTRACT = "0x000000000000000000000000000000000000dEaD" as Address;

/** How often to re-drive in-flight payment intents (background/crash backstop — review 035). */
const RECONCILE_INTERVAL_MS = 30_000;

/**
 * Composition root for the autonomous risk-quotation & settlement agent. Wires live subgraph → score
 * → signed quote → policy-capped Circle wallet → payment executor → REST/MCP → autonomous monitor.
 * Every prerequisite is guarded: missing config disables that capability with an explicit warning
 * (never a fabricated action). The one real USDC action (posting the quote bond) requires a
 * configured, funded Circle wallet — see docs/arc-agent-stack.md §"Transaction links" / §13 checklist.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  log.info({ chainEnv: env.CHAIN_ENV }, "vouch agent starting");

  const freshness: FreshnessConfig | null = env.SUBGRAPH_URL
    ? {
        rpcUrl: env.ARC_RPC_URL,
        maxLagBlocks: env.SUBGRAPH_MAX_LAG_BLOCKS,
        maxStalenessSeconds: env.SUBGRAPH_MAX_STALENESS_SECONDS,
        deploymentId: env.SUBGRAPH_DEPLOYMENT_ID,
      }
    : null;

  const core = buildCore(env, freshness);
  if (!core) {
    log.warn("agent core not fully configured — starting /health only (see docs/arc-agent-stack.md)");
  }

  // REST is always started so /health is reachable even in a degraded config.
  if (core) {
    const app = createRestServer(core.core, { allowManualPay: env.AGENT_ALLOW_MANUAL_PAY });
    await app.listen({ port: env.AGENT_HTTP_PORT, host: "0.0.0.0" });
    log.info({ port: env.AGENT_HTTP_PORT, allowManualPay: env.AGENT_ALLOW_MANUAL_PAY }, "REST server listening");

    // Periodic reconcile: finalize intents whose background drive didn't complete (crash/restart
    // backstop for the non-blocking executor — review 035). Startup reconcile runs in the orchestrator.
    const reconcileTimer = setInterval(() => {
      void core.executor.reconcile().catch((err: unknown) => logError("reconcile", err));
    }, RECONCILE_INTERVAL_MS);
    reconcileTimer.unref?.();

    // Autonomous monitor: reconcile in-flight intents, then react to job openings.
    if (env.VOUCH_CORE_ADDRESS && env.ARC_RPC_URL) {
      const orchestrator = new Orchestrator({
        reconcile: () => core.executor.reconcile(),
        onJobOpened: async (jobId) => {
          // The on-chain JobCreated does not carry our quoteId (documented limitation); this build
          // records the observation. Wiring releaseBond requires the escrow contract-execution path.
          log.info({ jobId: jobId.toString() }, "observed job open on a quoted provider");
        },
      });
      await orchestrator.start();
      const client = createArcClient(env.CHAIN_ENV, env.ARC_RPC_URL);
      watchJobEvents(client, env.VOUCH_CORE_ADDRESS as Address, (e) => {
        void orchestrator.handleJobEvent(e).catch((err: unknown) => logError("orchestrator", err));
      });
      log.info("autonomous monitor active");
    } else {
      log.warn("VOUCH_CORE_ADDRESS / ARC_RPC_URL unset — autonomous monitoring disabled");
    }
  }
}

interface BuiltCore {
  core: AgentCore;
  executor: PaymentExecutor;
}

function buildCore(env: AgentEnv, freshness: FreshnessConfig | null): BuiltCore | null {
  if (!env.SUBGRAPH_URL || !freshness) {
    log.warn("SUBGRAPH_URL unset — cannot score quotes (live data is load-bearing)");
    return null;
  }
  if (!env.QUOTE_SIGNER_PK) {
    log.warn("QUOTE_SIGNER_PK unset — cannot sign quotes");
    return null;
  }
  const subgraphUrl = env.SUBGRAPH_URL;
  const signerAccount = privateKeyToAccount(env.QUOTE_SIGNER_PK as `0x${string}`);

  // Wallet: honest guard. If unconfigured, payments throw NotImplemented (quotes still work).
  let wallet: AgentWallet | null = null;
  try {
    wallet = createAgentWallet({
      apiKey: env.CIRCLE_API_KEY,
      entitySecret: env.CIRCLE_ENTITY_SECRET,
      walletId: env.AGENT_WALLET_ID,
      usdcTokenId: env.AGENT_USDC_TOKEN_ID,
    });
  } catch (err) {
    if (err instanceof NotImplementedError) log.warn({ reason: err.message }, "agent wallet not configured");
    else throw err;
  }

  const escrow = (env.QUOTE_BOND_ESCROW_ADDRESS as Address) ?? FALLBACK_VERIFYING_CONTRACT;
  const allowlist = env.AGENT_DEST_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean);
  const store = new PrismaAgentStore({
    perTxCap: env.AGENT_PER_TX_CAP,
    dailyCap: env.AGENT_DAILY_CAP,
    walletLockKey: 1,
  });

  // The executor is both the core's PaymentDriver and the orchestrator's reconcile source. When the
  // wallet is unconfigured it runs against a stub whose calls fail loudly (never fabricates a tx).
  // The chain reader powers the pre-send chain-safety + escrow-deployed preflight (review 032/040).
  const chainReader = env.ARC_RPC_URL ? createArcClient(env.CHAIN_ENV, env.ARC_RPC_URL) : undefined;
  const executor = new PaymentExecutor({
    wallet: wallet ?? unconfiguredWallet(),
    store,
    policy: makeSpendPolicy(env.AGENT_PER_TX_CAP, allowlist),
    chainId: env.ARC_CHAIN_ID,
    usdcToken: env.USDC_ADDRESS as Address,
    escrowAddress: escrow,
    chainReader,
  });

  const core = new AgentCore({
    getProviderRisk: (provider) => getProviderRisk(subgraphUrl, provider, freshness),
    scoreParams: { baseGuaranteeCap: 100_000_000n }, // 100 USDC base cap
    signerAccount,
    commitmentCfg: { chainId: env.ARC_CHAIN_ID, verifyingContract: escrow, quoteTtlSeconds: env.QUOTE_TTL_SECONDS },
    expectedSigner: signerAccount.address,
    bondAmount: env.AGENT_QUOTE_BOND_AMOUNT,
    escrowAddress: escrow,
    store,
    payments: executor,
    health: {
      subgraphOk: async () => {
        try {
          await assertFresh(subgraphUrl, freshness);
          return true;
        } catch {
          return false;
        }
      },
      walletConfigured: () => wallet !== null,
    },
    now: () => BigInt(Math.floor(Date.now() / 1000)),
    salt: () => randomUUID(),
  });

  return { core, executor };
}

/** A wallet stub whose calls fail loudly — used only to satisfy the executor when payments are off. */
function unconfiguredWallet(): AgentWallet {
  const notConfigured = () => Promise.reject(new NotImplementedError("agent wallet (payments) not configured"));
  return {
    getUsdcBalance: notConfigured,
    executeContract: notConfigured,
    getTransactionStatus: notConfigured,
  };
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
