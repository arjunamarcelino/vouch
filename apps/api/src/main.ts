import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
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
  // Cookie sessions require an explicit origin allowlist + credentials (a wildcard+credentials is
  // rejected by browsers). Match against an EXACT-MATCH Set — never a regex/substring, which would let
  // `withvouch.xyz.evil.com` through and hand an attacker the session cookie. Requests with no Origin
  // header (curl, same-origin, server-to-server) are allowed; any listed origin is echoed back.
  if (env.WEB_ORIGIN.length > 0) {
    const allow = new Set(env.WEB_ORIGIN);
    app.enableCors({
      origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
        if (!origin || allow.has(origin)) return cb(null, true);
        return cb(new Error("Not allowed by CORS"), false);
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    });
  }
  app.useGlobalFilters(new VouchErrorFilter());
  app.enableShutdownHooks();
  // API now writes operational Postgres — disconnect the pool cleanly on shutdown.
  process.once("beforeExit", () => {
    void prisma.$disconnect();
  });

  // OpenAPI: Swagger UI at /docs + raw spec at /openapi.json (gated off mainnet — attack-surface).
  if (env.CHAIN_ENV !== "arc-mainnet") {
    const config = new DocumentBuilder().setTitle("Vouch API").setVersion("1.0").build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, doc);
    app.getHttpAdapter().get("/openapi.json", (_req: unknown, res: { json(body: unknown): void }) => res.json(doc));
  }

  await app.listen(env.PORT);
  log.info({ port: env.PORT, chainEnv: env.CHAIN_ENV }, "vouch api listening");
}

bootstrap().catch((err: unknown) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, "api failed to start");
  process.exitCode = 1;
});
