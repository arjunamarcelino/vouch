import { z } from "zod";
import { ConfigInvalidError } from "@vouch/shared/errors";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3001),
    CHAIN_ENV: z.enum(["development", "arc-testnet", "arc-mainnet"]).default("development"),
    DATABASE_URL: z.string().optional(),
    SUBGRAPH_URL: z.string().url().optional(),
    SUBGRAPH_DEPLOYMENT_ID: z.string().optional(),
    SUBGRAPH_MAX_LAG_BLOCKS: z.coerce.number().int().positive().default(25),
    SUBGRAPH_MAX_STALENESS_SECONDS: z.coerce.number().int().positive().default(180),
    ARC_RPC_URL: z.string().url().optional(),
    VOUCH_CORE_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/u)
      .optional(),
  })
  .superRefine((e, ctx) => {
    // The block-lag freshness gate needs an RPC; no RPC ⇒ freshness unverifiable ⇒ must refuse.
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

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigInvalidError("Invalid api environment", parsed.error.flatten());
  }
  return parsed.data;
}
