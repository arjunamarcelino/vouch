import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { resetOperationalData, seedDemoData } from "@vouch/db";
import { ApiError } from "../common/errors";
import { loadEnv } from "../config/env";

// Anvil demo accounts (well-known test keys — safe to hardcode; never used for real funds).
const DEMO_CLIENT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const DEMO_PROVIDER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

/**
 * Demo scenario tooling. Mutates ONLY offchain operational state (never onchain funds, never the
 * agent's financial store). Fail-closed allowlist gate: refuses unless DEMO_MODE=true AND the chain is
 * a demo chain (development / arc-testnet) — never "not mainnet" (which would fail open on a misconfig).
 */
@Injectable()
export class DemoService {
  private readonly env = loadEnv();

  private assertAllowed(): void {
    const demoChain = this.env.CHAIN_ENV === "development" || this.env.CHAIN_ENV === "arc-testnet";
    if (!this.env.DEMO_MODE || !demoChain) {
      throw new ApiError("FORBIDDEN", "Demo tooling is disabled (requires DEMO_MODE=true on a demo chain)");
    }
  }

  async reset(): Promise<{ ok: true; reset: string[] }> {
    this.assertAllowed();
    await resetOperationalData();
    return {
      ok: true,
      reset: ["jobMetadata", "notificationState", "agentRunLog", "userProfile", "siweNonce", "idempotencyRecord", "preparedIntent", "trackedTransaction", "feedEvent"],
    };
  }

  async seed(): Promise<{ ok: true; clientRequestId: string; client: string; provider: string }> {
    this.assertAllowed();
    const clientRequestId = randomUUID();
    await seedDemoData({ client: DEMO_CLIENT, provider: DEMO_PROVIDER, clientRequestId, uiTitle: "Fix the auth bug" });
    return { ok: true, clientRequestId, client: DEMO_CLIENT, provider: DEMO_PROVIDER };
  }
}
