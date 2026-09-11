import { Injectable } from "@nestjs/common";
import {
  createPublicClient,
  fallback,
  http,
  encodeFunctionData,
  toFunctionSelector,
  toEventSelector,
  isAddressEqual,
  getAddress,
  slice,
  decodeFunctionData,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { VouchError } from "@vouch/shared/errors";
import { ApiError } from "../errors";
import { assuranceHubAbi } from "@vouch/shared/abis";
import { chainForEnv } from "@vouch/shared/chains";
import { jobStateFromOrdinal, type JobState, type PreparableFunction } from "@vouch/shared/schemas";
import { loadEnv, type ApiEnv } from "../../config/env";
import { resilient } from "../retry";

/** Minimal ERC-20 fragment for allowance/approve (USDC). */
const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const satisfies Abi;

export interface OnchainJob {
  client: Address;
  provider: Address;
  taskFee: bigint;
  guaranteeAmount: bigint;
  serviceFee: bigint;
  publicCriteriaHash: Hex;
  privateCriteriaCommitment: Hex;
  submissionCommitment: Hex;
  claimEvidenceCommitment: Hex;
  submissionDeadline: bigint;
  coverageDuration: bigint;
  coverageEnd: bigint;
  claimResolutionDeadline: bigint;
  status: JobState;
  statusOrdinal: number;
}

/**
 * The single chain-access surface (Phase-0 frozen contract). viem public client with a `fallback`
 * transport (one flaky RPC can't fail-open) and `batch: { multicall: true }` so concurrent reads
 * coalesce into one Multicall3 round-trip. Every network call is bounded (timeout + transient-only
 * retry). Reads are authoritative; this service never signs or submits.
 */
@Injectable()
export class ChainService {
  private readonly env: ApiEnv = loadEnv();
  private client: PublicClient | undefined;
  private evaluatorRoleCache: Hex | undefined;
  private usdcCache: Address | undefined;

  /** Expected chainId — derived from CHAIN_ENV (single source; no standalone ARC_CHAIN_ID). */
  readonly chainId: number = chainForEnv(this.env.CHAIN_ENV).id;

  private rpc(): PublicClient {
    if (this.client) return this.client;
    if (!this.env.ARC_RPC_URL) throw new VouchError("CHAIN_NOT_CONFIGURED", "ARC_RPC_URL not configured");
    const transports = [http(this.env.ARC_RPC_URL)];
    if (this.env.ARC_RPC_URL_FALLBACK) transports.push(http(this.env.ARC_RPC_URL_FALLBACK));
    this.client = createPublicClient({
      chain: chainForEnv(this.env.CHAIN_ENV),
      transport: fallback(transports, { retryCount: 0 }), // we own retries via resilient()
      batch: { multicall: true },
    }) as PublicClient;
    return this.client;
  }

  private hub(): Address {
    if (!this.env.VOUCH_CORE_ADDRESS) throw new VouchError("CHAIN_NOT_CONFIGURED", "VOUCH_CORE_ADDRESS not configured");
    return getAddress(this.env.VOUCH_CORE_ADDRESS);
  }

  /** The hub (AssuranceHub) address — the `to` for every job/claim action. */
  hubAddress(): Address {
    return this.hub();
  }

  private opts() {
    return { timeoutMs: this.env.RPC_TIMEOUT_MS, retries: this.env.RPC_MAX_RETRIES };
  }

  // ---------------- reads ----------------

  async getBlockNumber(): Promise<bigint> {
    return resilient(() => this.rpc().getBlockNumber(), this.opts());
  }

  async getJob(jobId: bigint): Promise<OnchainJob> {
    // Consume viem's ABI-inferred struct directly (no `as unknown as Record` cast) so a future ABI
    // field-rename/reorder fails at COMPILE time instead of silently yielding `undefined` (review 059).
    const raw = await resilient(
      () =>
        this.rpc().readContract({
          address: this.hub(),
          abi: assuranceHubAbi,
          functionName: "getJob",
          args: [jobId],
        }),
      this.opts(),
    );
    const ordinal = Number(raw.status);
    return {
      client: raw.client,
      provider: raw.provider,
      taskFee: raw.taskFee,
      guaranteeAmount: raw.guaranteeAmount,
      serviceFee: raw.serviceFee,
      publicCriteriaHash: raw.publicCriteriaHash,
      privateCriteriaCommitment: raw.privateCriteriaCommitment,
      submissionCommitment: raw.submissionCommitment,
      claimEvidenceCommitment: raw.claimEvidenceCommitment,
      submissionDeadline: raw.submissionDeadline,
      coverageDuration: raw.coverageDuration,
      coverageEnd: raw.coverageEnd,
      claimResolutionDeadline: raw.claimResolutionDeadline,
      status: jobStateFromOrdinal(ordinal),
      statusOrdinal: ordinal,
    };
  }

  async paused(): Promise<boolean> {
    return resilient(
      () =>
        this.rpc().readContract({ address: this.hub(), abi: assuranceHubAbi, functionName: "paused" }) as Promise<boolean>,
      this.opts(),
    );
  }

  async evaluatorRole(): Promise<Hex> {
    if (this.evaluatorRoleCache) return this.evaluatorRoleCache;
    const role = (await resilient(
      () => this.rpc().readContract({ address: this.hub(), abi: assuranceHubAbi, functionName: "EVALUATOR_ROLE" }),
      this.opts(),
    )) as Hex;
    this.evaluatorRoleCache = role;
    return role;
  }

  async hasRole(role: Hex, account: string): Promise<boolean> {
    return resilient(
      () =>
        this.rpc().readContract({
          address: this.hub(),
          abi: assuranceHubAbi,
          functionName: "hasRole",
          args: [role, getAddress(account)],
        }) as Promise<boolean>,
      this.opts(),
    );
  }

  async usdc(): Promise<Address> {
    if (this.env.ARC_USDC_ADDRESS) return getAddress(this.env.ARC_USDC_ADDRESS);
    if (this.usdcCache) return this.usdcCache;
    const addr = (await resilient(
      () => this.rpc().readContract({ address: this.hub(), abi: assuranceHubAbi, functionName: "usdc" }),
      this.opts(),
    )) as Address;
    this.usdcCache = addr;
    return addr;
  }

  async allowance(owner: string): Promise<bigint> {
    const token = await this.usdc();
    return resilient(
      () =>
        this.rpc().readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [getAddress(owner), this.hub()],
        }) as Promise<bigint>,
      this.opts(),
    );
  }

  async getTransaction(hash: Hex) {
    return resilient(() => this.rpc().getTransaction({ hash }), this.opts());
  }

  async claimFiled(jobId: bigint): Promise<boolean> {
    return resilient(
      () =>
        this.rpc().readContract({
          address: this.hub(),
          abi: assuranceHubAbi,
          functionName: "claimFiled",
          args: [jobId],
        }) as Promise<boolean>,
      this.opts(),
    );
  }

  /**
   * Latest `ConfidentialEvaluationResolved` for a job (the CRE verdict), or null if none yet. Decoded
   * defensively — a malformed/mismatched event fails closed (the API never fabricates a verdict). A
   * zero evidenceCommitment on this event is the LEGITIMATE timeout path, not malformed.
   */
  async confidentialResolution(
    jobId: bigint,
  ): Promise<{ covered: boolean; serviceCredit: bigint; evidenceCommitment: Hex; evaluatedAt: bigint } | null> {
    const event = (assuranceHubAbi as readonly { type: string; name?: string }[]).find(
      (x) => x.type === "event" && x.name === "ConfidentialEvaluationResolved",
    );
    // Bound the scan to the configured deploy block (falls back to earliest only if unset) so hosted
    // RPCs don't reject the range as the chain grows (review 057).
    const fromBlock = this.env.VOUCH_DEPLOY_BLOCK !== undefined ? BigInt(this.env.VOUCH_DEPLOY_BLOCK) : "earliest";
    const logs = (await resilient(
      () =>
        this.rpc().getLogs({
          address: this.hub(),
          event: event as never,
          args: { jobId } as never,
          fromBlock,
          toBlock: "latest",
        }),
      this.opts(),
    )) as { args?: Record<string, unknown> }[];
    if (logs.length === 0) return null;
    const a = logs[logs.length - 1]?.args;
    if (!a || typeof a.covered !== "boolean" || typeof a.serviceCredit !== "bigint" || typeof a.evidenceCommitment !== "string") {
      throw new ApiError("CRE_RESULT_MALFORMED", "Malformed ConfidentialEvaluationResolved");
    }
    return {
      covered: a.covered,
      serviceCredit: a.serviceCredit,
      evidenceCommitment: a.evidenceCommitment as Hex,
      evaluatedAt: typeof a.evaluatedAt === "bigint" ? a.evaluatedAt : 0n,
    };
  }

  async getTransactionReceipt(hash: Hex) {
    return resilient(() => this.rpc().getTransactionReceipt({ hash }), this.opts());
  }

  /** Receipt, or null when the tx is not yet mined (an expected PENDING, not an error). */
  async getReceiptOrNull(hash: Hex): Promise<Awaited<ReturnType<PublicClient["getTransactionReceipt"]>> | null> {
    try {
      return await this.getTransactionReceipt(hash);
    } catch (err) {
      if (err instanceof TransactionReceiptNotFoundError || /could not be found|not be found/i.test(String(err))) {
        return null;
      }
      throw err;
    }
  }

  // ---------------- encode / selectors (pure) ----------------

  /** Encode calldata against the frozen `as const` ABIs (hub for job/claim; USDC for approve). */
  encode(functionName: PreparableFunction, args: readonly unknown[]): Hex {
    const abi = functionName === "approve" ? erc20Abi : assuranceHubAbi;
    // viem's typed overloads need a concrete fn/args pair; the caller supplies a validated tuple.
    return encodeFunctionData({ abi, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
  }

  /** 4-byte selector for a function, derived from the frozen ABI (never a hand-rolled signature). */
  functionSelector(functionName: PreparableFunction): Hex {
    const abi = functionName === "approve" ? erc20Abi : assuranceHubAbi;
    const item = (abi as readonly { type: string; name?: string }[]).find(
      (x) => x.type === "function" && x.name === functionName,
    );
    if (!item) throw new VouchError("VALIDATION_FAILED", `Unknown function ${functionName}`);
    return toFunctionSelector(item as never);
  }

  /** topic0 for an event on the hub ABI (drives the track-time event-signature check). */
  eventTopic0(eventName: string): Hex {
    const item = (assuranceHubAbi as readonly { type: string; name?: string }[]).find(
      (x) => x.type === "event" && x.name === eventName,
    );
    if (!item) throw new VouchError("VALIDATION_FAILED", `Unknown event ${eventName}`);
    return toEventSelector(item as never);
  }

  // ---------------- receipt helpers (pure over fetched data) ----------------

  addressEq(a: string | null | undefined, b: string): boolean {
    if (!a) return false;
    try {
      return isAddressEqual(getAddress(a), getAddress(b));
    } catch {
      return false;
    }
  }

  /** First 4 bytes of a fetched tx's calldata (`input`, NOT `data`). */
  selectorOf(input: Hex): Hex {
    return slice(input, 0, 4);
  }

  decodeCall(input: Hex, functionName: PreparableFunction) {
    const abi = functionName === "approve" ? erc20Abi : assuranceHubAbi;
    return decodeFunctionData({ abi, data: input } as Parameters<typeof decodeFunctionData>[0]);
  }

  /** Extract typed logs for `eventName` from a receipt's logs (topic0 + ABI matched by viem). */
  eventsFromLogs(eventName: string, logs: readonly unknown[]) {
    return parseEventLogs({ abi: assuranceHubAbi, eventName: eventName as never, logs: logs as never });
  }
}
