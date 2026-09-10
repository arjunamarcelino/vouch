import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { SpendPolicyViolationError } from "@vouch/shared/errors";
import { makeSpendPolicy } from "../wallet/policy";
import type { AgentWallet } from "../wallet/agentWallet";
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
      status: "PLANNED",
      providerRef: null,
      txHash: null,
      attempts: 0,
    });
    return { ok: true, idempotencyKey: i.idempotencyKey };
  }

  async updateIntentStatus(
    key: string,
    status: string,
    fields: { providerRef?: string; txHash?: string; incrementAttempt?: boolean } = {},
  ): Promise<void> {
    const it = this.intents.get(key)!;
    it.status = status;
    if (fields.providerRef !== undefined) it.providerRef = fields.providerRef;
    if (fields.txHash !== undefined) it.txHash = fields.txHash;
    if (fields.incrementAttempt) it.attempts += 1;
  }

  async getIntent(key: string): Promise<StoredIntent | null> {
    return this.intents.get(key) ?? null;
  }

  async findInFlightIntents(): Promise<StoredIntent[]> {
    return [...this.intents.values()].filter((i) => i.status === "SUBMITTING" || i.status === "SUBMITTED");
  }
}

class FakeWallet implements AgentWallet {
  sendCount = 0;
  statuses: string[];
  private idx = 0;
  constructor(statuses: string[] = ["SENT", "COMPLETE"]) {
    this.statuses = statuses;
  }
  async getUsdcBalance(): Promise<string> {
    return "0";
  }
  async sendUsdc(args: { destination: string; amountDecimal: string; idempotencyKey: string }) {
    this.sendCount += 1;
    return { id: `tx-${args.idempotencyKey}`, state: "INITIATED" };
  }
  async getTransactionStatus(): Promise<string> {
    const s = this.statuses[Math.min(this.idx, this.statuses.length - 1)]!;
    this.idx += 1;
    return s;
  }
}

function executor(store: FakeStore, wallet: FakeWallet) {
  return new PaymentExecutor({
    wallet,
    store,
    policy: makeSpendPolicy(1_000_000n, [ESCROW]),
    chainId: 5042002,
    usdcToken: USDC,
    sleep: async () => {},
  });
}

test("happy path: PLANNED → CONFIRMED, one sendUsdc", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["SENT", "COMPLETE"]);
  const final = await executor(store, wallet).execute({
    quoteId: QUOTE,
    action: "POST_BOND",
    amountBaseUnits: 500_000n,
    destination: ESCROW,
  });
  assert.equal(final.status, "CONFIRMED");
  assert.equal(wallet.sendCount, 1);
});

test("idempotent: a second execute does not re-send", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["COMPLETE"]);
  const ex = executor(store, wallet);
  const req = { quoteId: QUOTE, action: "POST_BOND" as const, amountBaseUnits: 500_000n, destination: ESCROW };
  await ex.execute(req);
  const second = await ex.execute(req);
  assert.equal(second.status, "CONFIRMED");
  assert.equal(wallet.sendCount, 1); // not re-sent
});

test("per-tx cap violation throws and never sends", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet();
  await assert.rejects(
    () =>
      executor(store, wallet).execute({
        quoteId: QUOTE,
        action: "POST_BOND",
        amountBaseUnits: 5_000_000n, // over 1 USDC cap
        destination: ESCROW,
      }),
    (e: unknown) => e instanceof SpendPolicyViolationError,
  );
  assert.equal(wallet.sendCount, 0);
});

test("daily-cap denial from the store throws and never sends", async () => {
  const store = new FakeStore();
  store.denyDailyCap = true;
  const wallet = new FakeWallet();
  await assert.rejects(
    () =>
      executor(store, wallet).execute({
        quoteId: QUOTE,
        action: "POST_BOND",
        amountBaseUnits: 500_000n,
        destination: ESCROW,
      }),
    (e: unknown) => e instanceof SpendPolicyViolationError,
  );
  assert.equal(wallet.sendCount, 0);
});

test("failed provider status → intent FAILED", async () => {
  const store = new FakeStore();
  const wallet = new FakeWallet(["FAILED"]);
  const final = await executor(store, wallet).execute({
    quoteId: QUOTE,
    action: "POST_BOND",
    amountBaseUnits: 500_000n,
    destination: ESCROW,
  });
  assert.equal(final.status, "FAILED");
});

test("reconcile re-drives a SUBMITTED intent with a providerRef", async () => {
  const store = new FakeStore();
  const key = "k1";
  store.intents.set(key, {
    idempotencyKey: key,
    quoteId: QUOTE,
    action: "POST_BOND",
    amount: "500000",
    destination: ESCROW,
    status: "SUBMITTED",
    providerRef: "tx-k1",
    txHash: null,
    attempts: 1,
  });
  const wallet = new FakeWallet(["COMPLETE"]);
  await executor(store, wallet).reconcile();
  assert.equal(store.intents.get(key)!.status, "CONFIRMED");
  assert.equal(wallet.sendCount, 0); // re-queried, not re-sent
});

test("reconcile re-POSTs a SUBMITTING intent that has no providerRef (crash before store)", async () => {
  const store = new FakeStore();
  const key = "k2";
  store.intents.set(key, {
    idempotencyKey: key,
    quoteId: QUOTE,
    action: "POST_BOND",
    amount: "500000",
    destination: ESCROW,
    status: "SUBMITTING",
    providerRef: null,
    txHash: null,
    attempts: 1,
  });
  const wallet = new FakeWallet(["COMPLETE"]);
  await executor(store, wallet).reconcile();
  assert.equal(wallet.sendCount, 1); // safe idempotent re-POST
  assert.equal(store.intents.get(key)!.status, "CONFIRMED");
});
