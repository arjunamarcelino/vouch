import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { createLogger } from "@vouch/shared/logger";
import { VouchErrorFilter } from "./graph/vouch-error.filter";

const log = createLogger("api");

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new VouchErrorFilter());
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  log.info({ port: env.PORT, chainEnv: env.CHAIN_ENV }, "vouch api listening");
}

bootstrap().catch((err: unknown) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, "api failed to start");
  process.exitCode = 1;
});
