import { Injectable } from "@nestjs/common";
import {
  createPublicClient,
  fallback,
  http,
  isAddressEqual,
  getAddress,
  recoverMessageAddress,
  type Hex,
  type PublicClient,
} from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { chainForEnv } from "@vouch/shared/chains";
import { createNonce, consumeNonce, upsertProfile } from "@vouch/db";
import { ApiError } from "../common/errors";
import { loadEnv } from "../config/env";

/**
 * SIWE (EIP-4361) verification. Ordering is load-bearing (SIWE deep-dive): bind domain/chainId/uri by
 * hand (viem's verify IGNORES chainId), pure-validate expiry, then CONSUME the nonce atomically BEFORE
 * the signature check (so two concurrent verifies can't both win), then verify the signature. A
 * consumed nonce + bad signature is intentionally burned. Fail-closed: any failure → UNAUTHORIZED.
 */
@Injectable()
export class SiweService {
  private readonly env = loadEnv();
  private readonly chainId = chainForEnv(this.env.CHAIN_ENV).id;
  private client: PublicClient | undefined;

  private rpc(): PublicClient | undefined {
    if (!this.env.ARC_RPC_URL) return undefined; // EOA path works offline (recoverMessageAddress)
    if (!this.client) {
      const transports = [http(this.env.ARC_RPC_URL)];
      if (this.env.ARC_RPC_URL_FALLBACK) transports.push(http(this.env.ARC_RPC_URL_FALLBACK));
      this.client = createPublicClient({ chain: chainForEnv(this.env.CHAIN_ENV), transport: fallback(transports) }) as PublicClient;
    }
    return this.client;
  }

  async issueNonce(): Promise<{ nonce: string }> {
    const nonce = generateSiweNonce();
    await createNonce(nonce, new Date(Date.now() + this.env.SIWE_NONCE_TTL_SECONDS * 1000));
    return { nonce };
  }

  async verify(message: string, signature: Hex): Promise<{ address: string }> {
    const parsed = parseSiweMessage(message);
    if (!parsed.address || !parsed.nonce || parsed.chainId === undefined) {
      throw new ApiError("UNAUTHORIZED", "Malformed SIWE message");
    }
    // (a) bind domain / chainId / uri to config (verify does NOT check chainId).
    if (this.env.SIWE_DOMAIN && parsed.domain !== this.env.SIWE_DOMAIN) {
      throw new ApiError("UNAUTHORIZED", "Bad domain");
    }
    if (parsed.chainId !== this.chainId) throw new ApiError("UNAUTHORIZED", "Wrong chain");
    if (this.env.SIWE_DOMAIN && parsed.uri) {
      try {
        if (new URL(parsed.uri).host !== this.env.SIWE_DOMAIN) throw new Error("uri host");
      } catch {
        throw new ApiError("UNAUTHORIZED", "Bad uri");
      }
    }

    // (b) offline field/expiry validation (notBefore / expirationTime).
    if (!validateSiweMessage({ message: parsed, nonce: parsed.nonce, time: new Date() })) {
      throw new ApiError("UNAUTHORIZED", "SIWE validation failed");
    }

    // (c) ATOMIC single-use nonce consume BEFORE the signature check (replay ordering).
    if (!(await consumeNonce(parsed.nonce, parsed.address))) {
      throw new ApiError("UNAUTHORIZED", "Nonce invalid, used, or expired");
    }

    // (d) signature: verifySiweMessage (ERC-1271/6492) when RPC is available; else EOA ecrecover.
    const ok = await this.checkSignature(message, signature, parsed.address);
    if (!ok) throw new ApiError("UNAUTHORIZED", "Bad signature");

    await upsertProfile(parsed.address);
    return { address: parsed.address.toLowerCase() };
  }

  private async checkSignature(message: string, signature: Hex, address: string): Promise<boolean> {
    const client = this.rpc();
    try {
      if (client) {
        return await client.verifySiweMessage({ message, signature, nonce: parseSiweMessage(message).nonce });
      }
      const recovered = await recoverMessageAddress({ message, signature });
      return isAddressEqual(getAddress(recovered), getAddress(address));
    } catch {
      // A thrown RPC error during the smart-account path must fail closed, never fail open.
      return false;
    }
  }
}
