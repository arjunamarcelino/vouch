import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import { SpendPolicyViolationError, VouchError } from "@vouch/shared/errors";
import { makeSpendPolicy } from "../wallet/policy";
import type { AgentWallet } from "../wallet/agentWallet";
import type { ChainReader } from "../wallet/chainGuard";
import {
  PaymentExecutor,
  type IntentStore,
  type StoredIntent,
  type ReserveArgs,
  type ReserveResult,
} from "./executor";

const ESCROW = "0x00000000000000000000000000000000000000ee" as Address;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const QUOTE = `0x${"a".repeat(64)}`;
const EXPIRES = 1_760_000_300n;

class FakeStore implements IntentStore {
  intents = new Map<string, StoredIntent>();
  denyDailyCap = false;

  async reserveIntent(i: ReserveArgs): Promise<ReserveResult> {
    const existing = this.intents.get(i.idempotencyKey);
    if (existing) return { ok: true, idempotencyKey: existing.idempotencyKey };
    if (this.denyDailyCap) return { ok: false, reasonCodes: ["DAILY_CAP_EXCEEDED"] };
    this.intents.set(i.idempotencyKey, {
      idempotencyKey: i.idempotencyKey,
      quoteId: i.quoteId,
      action: i.action,
      amount: i.amount,
      destination: i.destination,
      callData: i.callData,
      status: "PLANNED",
      providerRef: null,
      txHash: null,
      attempts: 0,
    });
    return { ok: true, idempotencyKey: i.idempotencyKey };
  }

  async updateIntentStatus(
    key: string,
    status: StoredIntent["status"],
    fields: { providerRef?: string; txHash?: string; incrementAttempt?: boolean } = {},
  ): Promise<StoredIntent> {
    const it = this.intents.get(key)!;
    it.status = status;
    if (fields.providerRef !== undefined) it.providerRef = fields.providerRef;
    if (fields.txHash !== undefined) it.txHash = fields.txHash;
    if (fields.incrementAttempt) it.attempts += 1;
    return { ...it };
  }

  async getIntent(key: string): Promise<StoredIntent | null> {
    return this.intents.get(key) ?? null;
  }

  async findInFlightIntents(): Promise<StoredIntent[]> {
    return [...this.intents.values()].filter((i) => i.status === "SUBMITTING" || i.status === "SUBMITTED");
  }
}

class FakeWallet implements AgentWallet {
  execCount = 0;
  private idx = 0;
  constructor(private readonly statuses: string[] = ["SENT", "COMPLETE"]) {}
  async getUsdcBalance(): Promise<string> {
    return "0";
  }
  async executeContract(args: { contractAddress: string; callData: Hex; idempotencyKey: string }) {
    this.execCount += 1;
    return { id: `tx-${args.idempotencyKey}`, state: "INITIATED" };
  }
  async getTransactionStatus(): Promise<string> {
    const s = this.statuses[Math.min(this.idx, this.statuses.length - 1)]!;
    this.idx += 1;
    return s;
  }
}

function executor(store: FakeStore, wallet: FakeWallet, chainReader?: ChainReader) {
  return new PaymentExecutor({
    wallet,
    store,
    policy: makeSpendPolicy(1_000_000n, [ESCROW]),
    chainId: 5042002,
    usdcToken: USDC,
    escrowAddress: ESCROW,
    chainReader,
    awaitConfirmation: true, // drive synchronously in tests so terminal state is assertable
    sleep: async () => {},
  });
}

const postReq = { quoteId: QUOTE, action: "POST_BOND" as const, amountBaseUnits: 500_000n, bondExpiresAt: EXPIRES };

test("happy path: PLANNED → CONFIRMED via contract execution, one call", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["SENT", "COMPLETE"]);
  const final = await executor(store, wallet).execute(postReq);
  assert.equal(final.status, "CONFIRMED");
  assert.equal(wallet.execCount, 1);
  assert.match(store.intents.get(final.idempotencyKey)!.callData, /^0x/u); // postBond calldata stored
});

test("idempotent: a second execute does not re-send", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["COMPLETE"]);
  const ex = executor(store, wallet);
  await ex.execute(postReq);
  const second = await ex.execute(postReq);
  assert.equal(second.status, "CONFIRMED");
  assert.equal(wallet.execCount, 1);
});

test("POST_BOND requires bondExpiresAt", async () => {
  const store = new FakeStore();
  await assert.rejects(
    () => executor(store, new FakeWallet()).execute({ quoteId: QUOTE, action: "POST_BOND", amountBaseUnits: 500_000n }),
    (e: unknown) => e instanceof VouchError && e.code === "VALIDATION_FAILED",
  );
});

test("per-tx cap violation throws and never sends", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet();
  await assert.rejects(
    () => executor(store, wallet).execute({ ...postReq, amountBaseUnits: 5_000_000n }),
    (e: unknown) => e instanceof SpendPolicyViolationError,
  );
  assert.equal(wallet.execCount, 0);
});

test("daily-cap denial from the store throws and never sends", async () => {
  const store = new FakeStore();
  store.denyDailyCap = true;
  const wallet = new FakeWallet();
  await assert.rejects(() => executor(store, wallet).execute(postReq), (e: unknown) => e instanceof SpendPolicyViolationError);
  assert.equal(wallet.execCount, 0);
});

test("failed provider status → intent FAILED", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["FAILED"]);
  const final = await executor(store, wallet).execute(postReq);
  assert.equal(final.status, "FAILED");
});

test("chain-safety preflight refuses when the escrow has no contract code (dEaD/EOA guard)", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["COMPLETE"]);
  const reader: ChainReader = {
    getChainId: async () => 5042002,
    getBytecode: async () => undefined, // escrow (and USDC) have no code
    readContract: async () => "USDC",
  };
  await assert.rejects(
    () => executor(store, wallet, reader).execute(postReq),
    (e: unknown) => e instanceof VouchError && e.code === "WRONG_CONTRACT",
  );
  assert.equal(wallet.execCount, 0);
});

test("refund path encodes refundBond and confirms", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["COMPLETE"]);
  const final = await executor(store, wallet).execute({ quoteId: QUOTE, action: "REFUND_BOND", amountBaseUnits: 0n });
  assert.equal(final.status, "CONFIRMED");
  assert.equal(final.action, "REFUND_BOND");
});

test("reconcile re-drives a SUBMITTED intent with a providerRef (no re-send)", async () => {
  const store = new FakeStore();
  const key = "k1";
  store.intents.set(key, {
    idempotencyKey: key,
    quoteId: QUOTE,
    action: "POST_BOND",
    amount: "500000",
    destination: ESCROW,
    callData: "0xdead",
    status: "SUBMITTED",
    providerRef: "tx-k1",
    txHash: null,
    attempts: 1,
  });
  const wallet = new FakeWallet(["COMPLETE"]);
  await executor(store, wallet).reconcile();
  assert.equal(store.intents.get(key)!.status, "CONFIRMED");
  assert.equal(wallet.execCount, 0);
});

test("reconcile re-POSTs stored callData when providerRef is missing (crash before store)", async () => {
  const store = new FakeStore();
  const key = "k2";
  store.intents.set(key, {
    idempotencyKey: key,
    quoteId: QUOTE,
    action: "POST_BOND",
    amount: "500000",
    destination: ESCROW,
    callData: "0xbeef",
    status: "SUBMITTING",
    providerRef: null,
    txHash: null,
    attempts: 1,
  });
  const wallet = new FakeWallet(["COMPLETE"]);
  await executor(store, wallet).reconcile();
  assert.equal(wallet.execCount, 1); // safe idempotent re-POST of stored callData
  assert.equal(store.intents.get(key)!.status, "CONFIRMED");
});
