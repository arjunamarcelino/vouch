import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ConfigInvalidError } from "@vouch/shared/errors";
import { HEX_ADDRESS_RE } from "@vouch/shared/schemas";

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
      .regex(HEX_ADDRESS_RE)
      .optional(),
    // Base URL of the agent's REST core (apps/agent). The dashboard reads quotes / decision traces
    // via the agent, NOT by importing its DB repo (architecture P2 — no shared-DB coupling).
    AGENT_URL: z.string().url().default("http://localhost:3002"),
    // Bearer key the API presents to the agent's REST core on signing routes (unset in dev).
    AGENT_API_KEY: z.string().optional(),

    // ---- chain (chainId itself is derived from CHAIN_ENV via chainForEnv — no standalone env) ----
    ARC_RPC_URL_FALLBACK: z.string().url().optional(),
    // USDC ERC-20 (6-dec). Optional: ChainService reads usdc() from the hub when unset (trust-minimized).
    ARC_USDC_ADDRESS: z
      .string()
      .regex(HEX_ADDRESS_RE)
      .optional(),
    CONFIRMATIONS_REQUIRED: z.coerce.number().int().positive().default(3),
    // Contract deploy block — the fromBlock floor for event scans (bounds eth_getLogs; review 057).
    VOUCH_DEPLOY_BLOCK: z.coerce.number().int().nonnegative().optional(),
    RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    RPC_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),

    // ---- session / SIWE ----
    SESSION_SECRET: z.string().min(32).optional(), // required outside development (superRefine)
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    SIWE_DOMAIN: z.string().optional(), // required outside development
    SIWE_NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    // CORS allowlist for cookie-credentialed requests. Comma-separated list of EXACT origins (a
    // wildcard + credentials is rejected by browsers). Parsed to string[]; required outside dev.
    // main.ts matches against an exact-match Set — never a regex/substring (an `includes` test would
    // match `withvouch.xyz.evil.com`). Add Vercel preview origins explicitly if needed.
    WEB_ORIGIN: z
      .string()
      .optional()
      .transform((s) => (s ?? "").split(",").map((o) => o.trim()).filter(Boolean)),

    // ---- authorization / demo ----
    ADMIN_ADDRESSES: z
      .string()
      .default("")
      .transform((s) => s.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)),
    DEMO_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    // ---- rate limiting (throttler) ----
    THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

    // ---- db pool ----
    DB_POOL_MAX: z.coerce.number().int().positive().optional(),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
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
    // Outside development, session/SIWE/CORS material is mandatory (fail-closed, no dev fallbacks).
    // AGENT_API_KEY is required too: the API presents it as the Bearer to the agent's signing routes,
    // and the agent is fail-closed on the same key — both ends must be set and identical in prod.
    if (e.CHAIN_ENV !== "development") {
      for (const [key, val] of [
        ["SESSION_SECRET", e.SESSION_SECRET],
        ["SIWE_DOMAIN", e.SIWE_DOMAIN],
        ["AGENT_API_KEY", e.AGENT_API_KEY],
      ] as const) {
        if (!val) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when CHAIN_ENV is not "development"`,
          });
        }
      }
      // WEB_ORIGIN is a parsed array — require at least one allowed origin (CORS credentials).
      if (e.WEB_ORIGIN.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["WEB_ORIGIN"],
          message: 'WEB_ORIGIN is required when CHAIN_ENV is not "development"',
        });
      }
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

// The JWT signing secret. Outside development SESSION_SECRET is REQUIRED (superRefine). In development,
// rather than a KNOWN hardcoded constant (which would let anyone forge a session — review 069), fall
// back to a per-process RANDOM secret: dev sessions simply don't survive a restart, and there is no
// public constant to forge with. Generated once so sign + verify agree within a process.
let devSecret: string | undefined;
export function sessionSecret(): string {
  const configured = loadEnv().SESSION_SECRET;
  if (configured) return configured;
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}
