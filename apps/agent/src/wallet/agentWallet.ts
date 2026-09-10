import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { NotImplementedError, VouchError } from "@vouch/shared/errors";

/**
 * Circle Agent Stack wallet adapter — Developer-Controlled Wallets (USDC on Arc), the "Agent Wallets"
 * component of the Circle Agent Stack (plan §6.1). Verified surface (SDK v10.8.0 + Context7):
 *   initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })
 *   client.getWalletTokenBalance({ id })
 *   client.createTransaction({ walletId, tokenId, destinationAddress, amounts, fee, idempotencyKey })
 *   client.getTransaction({ id })
 * The SDK generates the per-call entitySecretCiphertext from `entitySecret`. Arc enum:
 * Blockchain.ArcTestnet = "ARC-TESTNET", Blockchain.Arc = "ARC".
 *
 * HONEST guard: unconfigured → NotImplementedError. Never fabricates a balance or tx (plan rule).
 * The wallet holds MINIMAL USDC and moves only its own refundable bond (§0.1) under wallet policy.
 */

export interface AgentWalletConfig {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  /** Circle token id for USDC on the target chain (preferred over raw token address). */
  usdcTokenId: string;
}

export interface SendResult {
  id: string;
  state: string;
}

export interface AgentWallet {
  /** USDC balance as a decimal string (Circle returns decimal amounts). */
  getUsdcBalance(): Promise<string>;
  /** Create an outbound USDC transfer. `amountDecimal` e.g. "0.50". Idempotent on `idempotencyKey`. */
  sendUsdc(args: { destination: string; amountDecimal: string; idempotencyKey: string }): Promise<SendResult>;
  /** Poll a transaction's lifecycle state (INITIATED→…→COMPLETE / FAILED / DENIED / CANCELLED). */
  getTransactionStatus(id: string): Promise<string>;
}

function isConfigured(c: Partial<AgentWalletConfig>): c is AgentWalletConfig {
  return Boolean(c.apiKey && c.entitySecret && c.walletId && c.usdcTokenId);
}

class CircleAgentWallet implements AgentWallet {
  private readonly client: CircleDeveloperControlledWalletsClient;

  constructor(private readonly cfg: AgentWalletConfig) {
    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: cfg.apiKey,
      entitySecret: cfg.entitySecret,
    });
  }

  async getUsdcBalance(): Promise<string> {
    const res = await this.client.getWalletTokenBalance({ id: this.cfg.walletId });
    const balances = res.data?.tokenBalances ?? [];
    const usdc = balances.find((b) => b.token?.id === this.cfg.usdcTokenId);
    if (!usdc) return "0";
    return usdc.amount;
  }

  async sendUsdc(args: {
    destination: string;
    amountDecimal: string;
    idempotencyKey: string;
  }): Promise<SendResult> {
    const res = await this.client.createTransaction({
      walletId: this.cfg.walletId,
      tokenId: this.cfg.usdcTokenId,
      destinationAddress: args.destination,
      amount: [args.amountDecimal],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: args.idempotencyKey,
    });
    const data = res.data;
    if (!data?.id || !data.state) {
      throw new VouchError("WRONG_CONTRACT", "Circle createTransaction returned no id/state");
    }
    return { id: data.id, state: data.state };
  }

  async getTransactionStatus(id: string): Promise<string> {
    const res = await this.client.getTransaction({ id });
    const state = res.data?.transaction?.state;
    if (!state) throw new VouchError("WRONG_CONTRACT", `Circle getTransaction(${id}) returned no state`);
    return state;
  }
}

export function createAgentWallet(config: Partial<AgentWalletConfig>): AgentWallet {
  if (!isConfigured(config)) {
    throw new NotImplementedError(
      "Circle Agent Stack wallet not configured (set CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET + " +
        "AGENT_WALLET_ID + USDC token id; see docs/arc-agent-stack.md)",
    );
  }
  return new CircleAgentWallet(config);
}
