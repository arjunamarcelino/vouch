import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Offchain operational Postgres client (Prisma 7 + pg driver adapter).
 * Operational data ONLY — never money/reputation/secret material (plan §17.9).
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });

export const prisma = new PrismaClient({ adapter });

export * from "./generated/prisma/client";
export * from "./quotesRepo";
