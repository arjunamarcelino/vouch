import { z } from "zod";
import { ConfigInvalidError } from "@vouch/shared/errors";

const envSchema = z
  .object({
    CHAIN_ENV: z.enum(["development", "arc-testnet", "arc-mainnet"]).default("development"),
    ARC_RPC_URL: z.string().url().optional(),
    SUBGRAPH_URL: z.string().url().optional(),
    SUBGRAPH_DEPLOYMENT_ID: z.string().optional(),
    SUBGRAPH_MAX_LAG_BLOCKS: z.coerce.number().int().positive().default(25),
    SUBGRAPH_MAX_STALENESS_SECONDS: z.coerce.number().int().positive().default(180),
    VOUCH_CORE_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/u)
      .optional(),
    // Circle Agent Stack (agent wallet). Optional until wired; see wallet/agentWallet.ts.
    CIRCLE_API_KEY: z.string().optional(),
    CIRCLE_ENTITY_SECRET: z.string().optional(),
    AGENT_WALLET_ID: z.string().optional(),
    AGENT_USDC_TOKEN_ID: z.string().optional(),
    // Quote signing (dedicated key, MUST differ from the payment wallet — security L2).
    QUOTE_SIGNER_PK: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/u)
      .optional(),
    // Quote bond escrow (Track D) or custody fallback.
    QUOTE_BOND_ESCROW_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/u)
      .optional(),
    AGENT_QUOTE_BOND_AMOUNT: z.coerce.bigint().nonnegative().default(1_000_000n), // 1 USDC (6-dec)
    // Spend policy (defense-in-depth; Circle-side controls are primary — security B1).
    AGENT_PER_TX_CAP: z.coerce.bigint().nonnegative().default(1_000_000n),
    AGENT_DAILY_CAP: z.coerce.bigint().nonnegative().default(10_000_000n),
    AGENT_DEST_ALLOWLIST: z.string().default(""), // comma-separated addresses
    // Interfaces.
    AGENT_HTTP_PORT: z.coerce.number().int().positive().default(3002),
    // Auth + rate limit for the mutating/expensive REST endpoints (review 038). When AGENT_API_KEY is
    // unset, auth is DISABLED (dev only) and the server warns at startup.
    AGENT_API_KEY: z.string().optional(),
    AGENT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
    AGENT_ALLOW_MANUAL_PAY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // USDC contract on the target chain.
    USDC_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/u)
      .default("0x3600000000000000000000000000000000000000"),
    ARC_CHAIN_ID: z.coerce.number().int().positive().default(5042002),
    QUOTE_TTL_SECONDS: z.coerce.bigint().positive().default(300n),
  })
  .superRefine((e, ctx) => {
    // The block-lag freshness gate can't run without an RPC. No RPC ⇒ freshness unverifiable ⇒ the
    // agent would be blind ⇒ it must refuse. Encode that at the boundary (plan §5.4 / security F1).
    if (e.SUBGRAPH_URL && !e.ARC_RPC_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["ARC_RPC_URL"],
        message: "ARC_RPC_URL is required when SUBGRAPH_URL is set (subgraph freshness lag gate)",
      });
    }
    if (e.SUBGRAPH_URL && !e.SUBGRAPH_DEPLOYMENT_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["SUBGRAPH_DEPLOYMENT_ID"],
        message: "SUBGRAPH_DEPLOYMENT_ID is required when SUBGRAPH_URL is set (deployment trust-root pin)",
      });
    }
  });

export type AgentEnv = z.infer<typeof envSchema>;

/** Parse + validate process.env at the boundary. Throws a typed error on failure. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AgentEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigInvalidError("Invalid agent environment", parsed.error.flatten());
  }
  return parsed.data;
}
