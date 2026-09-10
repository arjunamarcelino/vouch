import { formatUnits, type Address } from "viem";
import { SpendPolicyViolationError } from "@vouch/shared/errors";
import type { PaymentAction } from "@vouch/shared/schemas";
import { idempotencyKey, paramsHash } from "./idempotency";
import { checkSpend, type SpendPolicy } from "../wallet/policy";
import type { AgentWallet } from "../wallet/agentWallet";

/**
 * Crash-safe payment executor (plan §6.4). Persist PLANNED → policy + reserve → SUBMITTING →
 * sendUsdc(idempotencyKey) → SUBMITTED → poll → CONFIRMED/FAILED. Exactly-once rests on Circle's
 * idempotency key + the persisted intent status; a benign retry returns the prior intent, never a
 * second payment. Reconcile re-drives in-flight intents on startup (re-POST with the same key is the
 * safe "did it land?" query — data-integrity H3). Retry is intentionally minimal (§0.1.2).
 *
 * Storage + wallet are INJECTED so this is unit-testable without a live DB or Circle account.
 */

export const USDC_DECIMALS = 6;

export interface StoredIntent {
  idempotencyKey: string;
  quoteId: string;
  action: string;
  amount: string;
  destination: string;
  status: string;
  providerRef: string | null;
  txHash: string | null;
  attempts: number;
}

export interface ReserveArgs {
  idempotencyKey: string;
  quoteId: string;
  action: PaymentAction;
  amount: string;
  token: string;
  destination: string;
  chainId: number;
  paramsHash: string;
}

export type ReserveResult =
  | { ok: true; idempotencyKey: string }
  | { ok: false; reasonCodes: string[] };

/** The persistence surface the executor needs (implemented by @vouch/db quotesRepo in production). */
export interface IntentStore {
  reserveIntent(intent: ReserveArgs): Promise<ReserveResult>;
  updateIntentStatus(
    key: string,
    status: string,
    fields?: { providerRef?: string; txHash?: string; incrementAttempt?: boolean },
  ): Promise<void>;
  getIntent(key: string): Promise<StoredIntent | null>;
  findInFlightIntents(): Promise<StoredIntent[]>;
}

export interface ExecutorDeps {
  wallet: AgentWallet;
  store: IntentStore;
  policy: SpendPolicy;
  chainId: number;
  usdcToken: Address;
  /** Max status polls before leaving the intent SUBMITTED for later reconciliation. */
  maxPolls?: number;
  /** Injected for tests; defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PayRequest {
  quoteId: string;
  action: PaymentAction;
  amountBaseUnits: bigint;
  destination: Address;
}

const TERMINAL_OK = new Set(["COMPLETE", "CONFIRMED"]);
const TERMINAL_FAIL = new Set(["FAILED", "DENIED", "CANCELLED"]);

function baseToDecimal(base: bigint): string {
  return formatUnits(base, USDC_DECIMALS);
}

export class PaymentExecutor {
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ExecutorDeps) {
    this.maxPolls = deps.maxPolls ?? 10;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Execute one payment idempotently. Returns the intent's final status. */
  async execute(req: PayRequest): Promise<StoredIntent> {
    const key = idempotencyKey(req.quoteId, req.action);

    // Idempotent short-circuit: an already-terminal/in-flight intent is not re-sent.
    const existing = await this.deps.store.getIntent(key);
    if (existing && existing.status !== "PLANNED") {
      return this.driveToTerminal(existing);
    }

    // Pure policy pre-check (per-tx cap + allowlist) before constructing anything.
    const pre = checkSpend(this.deps.policy, req.amountBaseUnits, req.destination);
    if (!pre.ok) throw new SpendPolicyViolationError(pre.reasonCodes);

    // Atomic reserve (daily cap + PLANNED insert). Idempotent on the key.
    const reserved = await this.deps.store.reserveIntent({
      idempotencyKey: key,
      quoteId: req.quoteId,
      action: req.action,
      amount: req.amountBaseUnits.toString(),
      token: this.deps.usdcToken,
      destination: req.destination,
      chainId: this.deps.chainId,
      paramsHash: paramsHash({
        amount: req.amountBaseUnits.toString(),
        destination: req.destination,
        token: this.deps.usdcToken,
        chainId: this.deps.chainId,
      }),
    });
    if (!reserved.ok) throw new SpendPolicyViolationError(reserved.reasonCodes);

    return this.submit(key, req);
  }

  private async submit(key: string, req: PayRequest): Promise<StoredIntent> {
    await this.deps.store.updateIntentStatus(key, "SUBMITTING", { incrementAttempt: true });
    const res = await this.deps.wallet.sendUsdc({
      destination: req.destination,
      amountDecimal: baseToDecimal(req.amountBaseUnits),
      idempotencyKey: key,
    });
    await this.deps.store.updateIntentStatus(key, "SUBMITTED", { providerRef: res.id });
    const intent = await this.deps.store.getIntent(key);
    return this.driveToTerminal(intent!);
  }

  /** Poll the provider until the tx reaches a terminal state, or leave it SUBMITTED for reconcile. */
  private async driveToTerminal(intent: StoredIntent): Promise<StoredIntent> {
    if (intent.status === "CONFIRMED" || intent.status === "FAILED") return intent;
    const ref = intent.providerRef;
    if (!ref) {
      // Crashed before providerRef was stored → safe idempotent re-POST is handled by reconcile().
      return intent;
    }
    for (let i = 0; i < this.maxPolls; i++) {
      const state = await this.deps.wallet.getTransactionStatus(ref);
      if (TERMINAL_OK.has(state)) {
        await this.deps.store.updateIntentStatus(intent.idempotencyKey, "CONFIRMED", { txHash: ref });
        return (await this.deps.store.getIntent(intent.idempotencyKey))!;
      }
      if (TERMINAL_FAIL.has(state)) {
        await this.deps.store.updateIntentStatus(intent.idempotencyKey, "FAILED");
        return (await this.deps.store.getIntent(intent.idempotencyKey))!;
      }
      await this.sleep(500);
    }
    return intent; // still pending → reconcile() will pick it up
  }

  /**
   * Startup crash reconciliation (plan §6.4): re-drive in-flight intents. Re-query by providerRef;
   * if we crashed before storing it, re-POST with the SAME idempotency key (Circle returns the
   * existing tx — never a double-pay).
   */
  async reconcile(): Promise<void> {
    const inFlight = await this.deps.store.findInFlightIntents();
    for (const intent of inFlight) {
      if (intent.providerRef) {
        await this.driveToTerminal(intent);
      } else {
        const res = await this.deps.wallet.sendUsdc({
          destination: intent.destination,
          amountDecimal: baseToDecimal(BigInt(intent.amount)),
          idempotencyKey: intent.idempotencyKey,
        });
        await this.deps.store.updateIntentStatus(intent.idempotencyKey, "SUBMITTED", {
          providerRef: res.id,
        });
        await this.driveToTerminal((await this.deps.store.getIntent(intent.idempotencyKey))!);
      }
    }
  }
}
