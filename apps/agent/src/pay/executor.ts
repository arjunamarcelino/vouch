import { encodeFunctionData, type Address, type Hex } from "viem";
import { SpendPolicyViolationError, VouchError } from "@vouch/shared/errors";
import { createLogger } from "@vouch/shared/logger";
import { quoteBondEscrowAbi } from "@vouch/shared/abis";
import type { PaymentAction, PaymentStatus } from "@vouch/shared/schemas";
import { idempotencyKey, paramsHash } from "./idempotency";
import { checkSpend, type SpendPolicy } from "../wallet/policy";
import { assertChainSafety, type ChainReader, type ChainGuardConfig } from "../wallet/chainGuard";
import type { AgentWallet } from "../wallet/agentWallet";

/**
 * Crash-safe payment executor (plan §6.4). The bond moves via the QuoteBondEscrow CONTRACT
 * (`postBond`/`refundBond`) through Circle DCW contract-execution — NOT a bare transfer (review 032),
 * so funds are recoverable. Persist PLANNED → policy + reserve → SUBMITTING → executeContract(key) →
 * SUBMITTED → poll → CONFIRMED/FAILED. Exactly-once rests on Circle's idempotency key + the persisted
 * intent status; a benign retry returns the prior intent. Reconcile re-POSTs the stored `callData`
 * with the same key (safe: Circle dedupes). Chain-safety is asserted before the first send (review 040).
 *
 * Storage + wallet + chain reader are INJECTED so this is unit-testable without a live DB/Circle/RPC.
 */

export const USDC_DECIMALS = 6;

export interface StoredIntent {
  idempotencyKey: string;
  quoteId: string;
  action: PaymentAction;
  amount: string;
  destination: string;
  callData: string;
  status: PaymentStatus;
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
  callData: string;
  chainId: number;
  paramsHash: string;
  /** Quote nonce (== quoteId) consumed atomically with the insert; set for POST_BOND (review 034). */
  nonce?: string;
}

export type ReserveResult =
  | { ok: true; idempotencyKey: string }
  | { ok: false; reasonCodes: string[] };

/** The persistence surface the executor needs (implemented by @vouch/db quotesRepo in production). */
export interface IntentStore {
  reserveIntent(intent: ReserveArgs): Promise<ReserveResult>;
  updateIntentStatus(
    key: string,
    status: PaymentStatus,
    fields?: { providerRef?: string; txHash?: string; incrementAttempt?: boolean },
  ): Promise<StoredIntent>;
  getIntent(key: string): Promise<StoredIntent | null>;
  findInFlightIntents(): Promise<StoredIntent[]>;
}

export interface ExecutorDeps {
  wallet: AgentWallet;
  store: IntentStore;
  policy: SpendPolicy;
  chainId: number;
  usdcToken: Address;
  /** The QuoteBondEscrow contract address (must have bytecode — guards against dEaD/EOA). */
  escrowAddress: Address;
  /** viem public client for the chain-safety preflight. Omit to skip (tests). */
  chainReader?: ChainReader;
  /** Max status polls before leaving the intent SUBMITTED for later reconciliation. */
  maxPolls?: number;
  /**
   * When false (default), `execute` returns as soon as the tx is SUBMITTED and drives it to terminal
   * in the BACKGROUND — so the HTTP request is never blocked on confirmation (review 035). The periodic
   * reconcile loop (index.ts) + startup reconcile are the crash backstops. Tests set true to drive
   * synchronously and assert the terminal state.
   */
  awaitConfirmation?: boolean;
  /** Injected for tests; defaults to backoff+jitter delay. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PayRequest {
  quoteId: string;
  action: PaymentAction;
  amountBaseUnits: bigint;
  /** Required for POST_BOND (the bond's on-chain expiry). */
  bondExpiresAt?: bigint;
}

const TERMINAL_OK: ReadonlySet<string> = new Set(["COMPLETE", "CONFIRMED"]);
const TERMINAL_FAIL: ReadonlySet<string> = new Set(["FAILED", "DENIED", "CANCELLED"]);

/** Exponential backoff (250ms→~4s cap) with full jitter, seeded deterministically per attempt. */
function backoffMs(attempt: number, rand: number): number {
  const capped = Math.min(4000, 250 * 2 ** attempt);
  return Math.floor(rand * capped);
}

const log = createLogger("agent:executor");

export class PaymentExecutor {
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly awaitConfirmation: boolean;
  private chainChecked = false;

  constructor(private readonly deps: ExecutorDeps) {
    this.maxPolls = deps.maxPolls ?? 10;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.awaitConfirmation = deps.awaitConfirmation ?? false;
  }

  private encodeCall(req: PayRequest): Hex {
    if (req.action === "POST_BOND") {
      if (req.bondExpiresAt === undefined) {
        throw new VouchError("VALIDATION_FAILED", "POST_BOND requires bondExpiresAt");
      }
      return encodeFunctionData({
        abi: quoteBondEscrowAbi,
        functionName: "postBond",
        args: [req.quoteId as Hex, req.amountBaseUnits, req.bondExpiresAt],
      });
    }
    return encodeFunctionData({
      abi: quoteBondEscrowAbi,
      functionName: "refundBond",
      args: [req.quoteId as Hex],
    });
  }

  /** Execute one bond action idempotently. Returns the intent's final stored state. */
  async execute(req: PayRequest): Promise<StoredIntent> {
    const key = idempotencyKey(req.quoteId, req.action);

    const existing = await this.deps.store.getIntent(key);
    if (existing && existing.status !== "PLANNED") return this.driveToTerminal(existing);

    // Pure policy pre-check applies to outbound-spend actions (POST_BOND). Refund moves escrow→poster.
    if (req.action === "POST_BOND") {
      const pre = checkSpend(this.deps.policy, req.amountBaseUnits, this.deps.escrowAddress);
      if (!pre.ok) throw new SpendPolicyViolationError(pre.reasonCodes);
    }

    const callData = this.encodeCall(req);
    const reserved = await this.deps.store.reserveIntent({
      idempotencyKey: key,
      quoteId: req.quoteId,
      action: req.action,
      amount: req.amountBaseUnits.toString(),
      token: this.deps.usdcToken,
      destination: this.deps.escrowAddress,
      callData,
      chainId: this.deps.chainId,
      paramsHash: paramsHash({
        amount: req.amountBaseUnits.toString(),
        destination: this.deps.escrowAddress,
        token: this.deps.usdcToken,
        chainId: this.deps.chainId,
      }),
      // POST_BOND consumes the quote's single-use nonce (== quoteId) atomically with the reserve.
      nonce: req.action === "POST_BOND" ? req.quoteId : undefined,
    });
    if (!reserved.ok) throw new SpendPolicyViolationError(reserved.reasonCodes);

    await this.ensureChainSafe();
    return this.submit(key, this.deps.escrowAddress, callData);
  }

  /** Chain-safety + escrow-deployed preflight, run once before the first send (review 040/032). */
  private async ensureChainSafe(): Promise<void> {
    if (this.chainChecked || !this.deps.chainReader) return;
    const cfg: ChainGuardConfig = { expectedChainId: this.deps.chainId, usdcAddress: this.deps.usdcToken };
    await assertChainSafety(this.deps.chainReader, cfg);
    const code = await this.deps.chainReader.getBytecode({ address: this.deps.escrowAddress });
    if (code === undefined || code === "0x") {
      // Catches the 0x…dEaD fallback / an EOA custody address → never a bare transfer to a non-contract.
      throw new VouchError("WRONG_CONTRACT", `No contract code at escrow ${this.deps.escrowAddress}`);
    }
    this.chainChecked = true;
  }

  private async submit(key: string, contractAddress: string, callData: Hex): Promise<StoredIntent> {
    await this.deps.store.updateIntentStatus(key, "SUBMITTING", { incrementAttempt: true });
    const res = await this.deps.wallet.executeContract({ contractAddress, callData, idempotencyKey: key });
    const submitted = await this.deps.store.updateIntentStatus(key, "SUBMITTED", { providerRef: res.id });
    if (this.awaitConfirmation) return this.driveToTerminal(submitted);
    // Non-blocking: return SUBMITTED now; finalize in the background (periodic reconcile is the backstop).
    void this.driveToTerminal(submitted).catch((err: unknown) =>
      log.error({ key, err: err instanceof Error ? err.message : String(err) }, "background drive failed"),
    );
    return submitted;
  }

  /** Poll until terminal, or leave SUBMITTED for reconcile. Backoff + jitter between polls. */
  private async driveToTerminal(intent: StoredIntent): Promise<StoredIntent> {
    if (intent.status === "CONFIRMED" || intent.status === "FAILED") return intent;
    const ref = intent.providerRef;
    if (!ref) return intent; // crashed before providerRef stored → reconcile() re-POSTs
    for (let i = 0; i < this.maxPolls; i++) {
      const state = await this.deps.wallet.getTransactionStatus(ref);
      if (TERMINAL_OK.has(state)) {
        return this.deps.store.updateIntentStatus(intent.idempotencyKey, "CONFIRMED", { txHash: ref });
      }
      if (TERMINAL_FAIL.has(state)) {
        return this.deps.store.updateIntentStatus(intent.idempotencyKey, "FAILED");
      }
      await this.sleep(backoffMs(i, jitterSeed(intent.idempotencyKey, i)));
    }
    return intent; // still pending → reconcile() picks it up
  }

  /**
   * Startup crash reconciliation (plan §6.4): re-drive in-flight intents. Re-query by providerRef; if
   * we crashed before storing it, re-POST the stored callData with the SAME idempotency key (Circle
   * returns the existing tx — never a double-execution).
   */
  async reconcile(): Promise<void> {
    const inFlight = await this.deps.store.findInFlightIntents();
    for (const intent of inFlight) {
      if (intent.providerRef) {
        await this.driveToTerminal(intent);
      } else {
        await this.ensureChainSafe();
        const res = await this.deps.wallet.executeContract({
          contractAddress: intent.destination,
          callData: intent.callData as Hex,
          idempotencyKey: intent.idempotencyKey,
        });
        const submitted = await this.deps.store.updateIntentStatus(intent.idempotencyKey, "SUBMITTED", {
          providerRef: res.id,
        });
        await this.driveToTerminal(submitted);
      }
    }
  }
}

/** Deterministic per-(key,attempt) jitter in [0,1) — avoids Math.random (varies without global state). */
function jitterSeed(key: string, attempt: number): number {
  let h = 2166136261 ^ attempt;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
