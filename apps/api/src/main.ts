import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { prisma } from "@vouch/db";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { createLogger } from "@vouch/shared/logger";
import { VouchErrorFilter } from "./common/vouch-error.filter";

const log = createLogger("api");

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  // Cookie sessions require an explicit origin + credentials (a wildcard+credentials is rejected).
  if (env.WEB_ORIGIN) app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.useGlobalFilters(new VouchErrorFilter());
  app.enableShutdownHooks();
  // API now writes operational Postgres — disconnect the pool cleanly on shutdown.
  process.once("beforeExit", () => {
    void prisma.$disconnect();
  });
  await app.listen(env.PORT);
  log.info({ port: env.PORT, chainEnv: env.CHAIN_ENV }, "vouch api listening");
}

bootstrap().catch((err: unknown) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, "api failed to start");
  process.exitCode = 1;
});
