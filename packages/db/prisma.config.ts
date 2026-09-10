import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: path.join(dirname, "prisma", "schema.prisma"),
  // Prisma 7 moved the Migrate/introspection connection URL out of schema.prisma.
  // The runtime PrismaClient connects via the @prisma/adapter-pg driver adapter
  // in src/index.ts; this URL is only used by `prisma migrate`/`db push`.
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
