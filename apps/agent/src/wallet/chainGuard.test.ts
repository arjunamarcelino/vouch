import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import { VouchError } from "@vouch/shared/errors";
import { assertChainSafety, type ChainReader, type ChainGuardConfig } from "./chainGuard";

const USDC = "0x3600000000000000000000000000000000000000" as Address;
const CFG: ChainGuardConfig = { expectedChainId: 5042002, usdcAddress: USDC };

function reader(over: Partial<Record<keyof ChainReader, unknown>> = {}): ChainReader {
  return {
    getChainId: async () => 5042002,
    getBytecode: async () => "0x60006000" as Hex,
    readContract: async () => "USDC",
    ...(over as Partial<ChainReader>),
  };
}

test("passes on correct chain + real USDC contract", async () => {
  await assertChainSafety(reader(), CFG);
});

test("wrong chain id → CHAIN_NOT_CONFIGURED", async () => {
  await assert.rejects(
    () => assertChainSafety(reader({ getChainId: async () => 1 }), CFG),
    (e: unknown) => e instanceof VouchError && e.code === "CHAIN_NOT_CONFIGURED",
  );
});

test("no bytecode at token address → WRONG_CONTRACT", async () => {
  await assert.rejects(
    () => assertChainSafety(reader({ getBytecode: async () => undefined }), CFG),
    (e: unknown) => e instanceof VouchError && e.code === "WRONG_CONTRACT",
  );
});

test("token symbol != USDC → WRONG_CONTRACT", async () => {
  await assert.rejects(
    () => assertChainSafety(reader({ readContract: async () => "FAKE" }), CFG),
    (e: unknown) => e instanceof VouchError && e.code === "WRONG_CONTRACT",
  );
});
