import { getAddress, erc20Abi, type Address, type Hex } from "viem";
import { VouchError } from "@vouch/shared/errors";

/**
 * Chain-safety preflight (plan §6.3). Asserts, BEFORE constructing any transfer, that we're on the
 * expected chain and pointed at the real USDC contract — chain-mismatch / wrong-contract protection.
 * Throws `CHAIN_NOT_CONFIGURED` / `WRONG_CONTRACT`; callers also pass `chain` explicitly to viem sends
 * as a second net.
 */

/** Minimal read surface (viem PublicClient satisfies this; kept small so it's trivially fakeable). */
export interface ChainReader {
  getChainId(): Promise<number>;
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: {
    address: Address;
    abi: typeof erc20Abi;
    functionName: "symbol";
  }): Promise<string>;
}

export interface ChainGuardConfig {
  expectedChainId: number;
  usdcAddress: Address;
}

export async function assertChainSafety(client: ChainReader, cfg: ChainGuardConfig): Promise<void> {
  const connected = await client.getChainId();
  if (connected !== cfg.expectedChainId) {
    throw new VouchError(
      "CHAIN_NOT_CONFIGURED",
      `Connected chain ${connected} != expected ${cfg.expectedChainId}`,
    );
  }

  // Token address must match config exactly (checksum-normalized).
  const expected = getAddress(cfg.usdcAddress);

  // Contract must actually have code (not an EOA / empty address).
  const code = await client.getBytecode({ address: expected });
  if (code === undefined || code === "0x") {
    throw new VouchError("WRONG_CONTRACT", `No contract code at USDC address ${expected}`);
  }

  // Defense-in-depth: confirm the token really is USDC on THIS chain.
  const symbol = await client.readContract({ address: expected, abi: erc20Abi, functionName: "symbol" });
  if (symbol !== "USDC") {
    throw new VouchError("WRONG_CONTRACT", `Token at ${expected} reports symbol "${symbol}", not USDC`);
  }
}
