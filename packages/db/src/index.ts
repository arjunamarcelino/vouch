import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Offchain operational Postgres client (Prisma 7 + pg driver adapter).
 * Operational data ONLY — never money/reputation/secret material (plan §17.9).
 */
// Pool sizing (performance review): PrismaPg wraps pg.Pool (default max 10). Tune via env so the
// idempotency-claim + tracked-tx + feed writes don't starve the pool under concurrency.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "",
  max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : undefined,
});

export const prisma = new PrismaClient({ adapter });

export * from "./generated/prisma/client";
export * from "./quotesRepo";
export * from "./apiRepo";
