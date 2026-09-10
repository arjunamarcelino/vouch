import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  CHAIN_ENV: z.enum(["development", "arc-testnet", "arc-mainnet"]).default("development"),
  DATABASE_URL: z.string().optional(),
  SUBGRAPH_URL: z.string().url().optional(),
  ARC_RPC_URL: z.string().url().optional(),
  VOUCH_CORE_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/u)
    .optional(),
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(source);
}
