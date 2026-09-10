import { z } from "zod";
import { ConfigInvalidError } from "@vouch/shared/errors";

const envSchema = z.object({
  CHAIN_ENV: z.enum(["development", "arc-testnet", "arc-mainnet"]).default("development"),
  ARC_RPC_URL: z.string().url().optional(),
  SUBGRAPH_URL: z.string().url().optional(),
  VOUCH_CORE_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/u)
    .optional(),
  // Circle Agent Stack (agent wallet). Optional until wired; see wallet/agentWallet.ts.
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
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
