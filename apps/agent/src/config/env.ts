import { z } from "zod";
import { ConfigInvalidError } from "@vouch/shared/errors";

const envSchema = z
  .object({
    CHAIN_ENV: z.enum(["development", "arc-testnet", "arc-mainnet"]).default("development"),
    ARC_RPC_URL: z.string().url().optional(),
    SUBGRAPH_URL: z.string().url().optional(),
    SUBGRAPH_DEPLOYMENT_ID: z.string().optional(),
    SUBGRAPH_STATUS_URL: z.string().url().optional(),
    SUBGRAPH_MAX_LAG_BLOCKS: z.coerce.number().int().positive().default(25),
    SUBGRAPH_MAX_STALENESS_SECONDS: z.coerce.number().int().positive().default(180),
    SUBGRAPH_FINALITY_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(0),
    VOUCH_CORE_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/u)
      .optional(),
    // Circle Agent Stack (agent wallet). Optional until wired; see wallet/agentWallet.ts.
    CIRCLE_API_KEY: z.string().optional(),
    CIRCLE_ENTITY_SECRET: z.string().optional(),
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
