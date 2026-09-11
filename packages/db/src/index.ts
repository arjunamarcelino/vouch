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
  // Explicit default (was the pg default of 10) sized for the concurrent write path — review 072.
  max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : 20,
});

export const prisma = new PrismaClient({ adapter });

export * from "./generated/prisma/client";
export * from "./quotesRepo";
export * from "./apiRepo";
