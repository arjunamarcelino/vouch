import { createLogger } from "@vouch/shared/logger";
import type { JobEvent } from "./monitor/watch";

/**
 * Autonomous orchestration loop (plan §8.2): on startup, reconcile in-flight payment intents; then
 * react to observed job-lifecycle events and initiate the next allowed action — without manual
 * transaction construction. Dedupes per jobId (JobCreated and JobFunded both fire for one job).
 *
 * Actions are INJECTED so this is testable and so the composition root decides the fund-moving step
 * (and can gate it on finality / escrow wiring). The prize-qualifying real USDC action — posting the
 * quote bond — happens at quote-issue time via the core; here the agent autonomously reacts to a job
 * opening on one of its quotes.
 *
 * KNOWN LIMITATION (documented in docs/arc-agent-stack.md): the on-chain `JobCreated` event does not
 * carry the agent's `quoteId`, so a precise quote↔job link needs an off-chain match (recompute jobHash
 * from job params) or a future event field. This build passes the observed `jobId` to the handler.
 */

const log = createLogger("agent:orchestrator");

export interface OrchestratorDeps {
  /** executor.reconcile — re-drive in-flight intents on startup. */
  reconcile(): Promise<void>;
  /** React to a job opening (finalized). E.g. release the bond backing the honored quote. */
  onJobOpened(jobId: bigint): Promise<void>;
  /** Minimum confirmations before acting on an event (Arc finality is sub-second; default 0). */
  minConfirmations?: bigint;
  /** Current chain head, for the finality gate. */
  chainHead?: () => Promise<bigint>;
}

export class Orchestrator {
  private readonly processed = new Set<string>();

  constructor(private readonly deps: OrchestratorDeps) {}

  /** Run startup reconciliation. Call before subscribing to events. */
  async start(): Promise<void> {
    log.info("reconciling in-flight payment intents");
    await this.deps.reconcile();
  }

  /** Handle one decoded job event. Idempotent per jobId; finality-gated. */
  async handleJobEvent(e: JobEvent): Promise<void> {
    const key = e.jobId.toString();
    if (this.processed.has(key)) return;

    const minConf = this.deps.minConfirmations ?? 0n;
    if (minConf > 0n && e.blockNumber !== null && this.deps.chainHead) {
      const head = await this.deps.chainHead();
      if (head - e.blockNumber < minConf) {
        log.info({ jobId: key, head: head.toString() }, "awaiting finality before acting");
        return; // not final yet; a later event/tick will re-trigger
      }
    }

    this.processed.add(key);
    log.info({ jobId: key, event: e.name }, "job opened — initiating next action");
    await this.deps.onJobOpened(e.jobId);
  }
}
