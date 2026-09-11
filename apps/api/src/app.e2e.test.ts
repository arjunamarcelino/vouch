import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "./app.module";
import { VouchErrorFilter } from "./common/vouch-error.filter";

// Boot smoke test: proves the whole module graph (Common/Auth/Graph/Health/Jobs/Agent) resolves via
// real Nest DI (needs decorator metadata — hence the SWC test loader) and that the correlation
// middleware + logging interceptor + error filter are wired. GET / and the liveness probe touch no
// DB/RPC. Development env → no session/CORS material required.
process.env.CHAIN_ENV = "development";

let app: INestApplication;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new VouchErrorFilter());
  await app.init();
});

after(async () => {
  await app?.close();
});

test("GET / returns the api identity", async () => {
  const res = await request(app.getHttpServer()).get("/");
  assert.equal(res.status, 200);
  assert.equal(res.body.name, "vouch-api");
});

test("GET /health liveness is 200 and echoes the correlation id", async () => {
  const res = await request(app.getHttpServer()).get("/health").set("x-correlation-id", "smoke-123");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.headers["x-correlation-id"], "smoke-123");
});
