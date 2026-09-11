import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { AppModule } from "../app.module";
import { VouchErrorFilter } from "../common/vouch-error.filter";

/**
 * DB-backed e2e (run via `pnpm --filter @vouch/api test:db`, which provisions a throwaway Postgres).
 * Covers the happy paths that need a real DB: SIWE nonce lifecycle + session, nonce single-use replay
 * rejection, and Stripe-style idempotency (replay vs conflict). No RPC needed — EOA signatures verify
 * offline via recoverMessageAddress.
 */
process.env.CHAIN_ENV = "development";
process.env.SESSION_SECRET ??= "x".repeat(40);

const CHAIN_ID = 5042002; // chainForEnv("development") → arc-testnet
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

let app: INestApplication;

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser()); // main.ts applies this in prod; the test app must too (reads session cookie)
  app.useGlobalFilters(new VouchErrorFilter());
  await app.init();
});

after(async () => {
  await app?.close();
});

async function signedSiwe(): Promise<{ message: string; signature: string }> {
  const server = app.getHttpServer();
  const { body } = await request(server).post("/auth/nonce").expect(201);
  const message = createSiweMessage({
    address: account.address,
    chainId: CHAIN_ID,
    domain: "localhost",
    nonce: body.nonce as string,
    uri: "http://localhost",
    version: "1",
  });
  const signature = await account.signMessage({ message });
  return { message, signature };
}

test("SIWE round-trip: nonce → verify → authenticated /auth/me", async () => {
  const server = app.getHttpServer();
  const { message, signature } = await signedSiwe();
  const verify = await request(server).post("/auth/verify").send({ message, signature }).expect(201);
  assert.equal((verify.body.address as string).toLowerCase(), account.address.toLowerCase());
  const raw = verify.headers["set-cookie"];
  const cookie = Array.isArray(raw) ? raw.join("; ") : (raw ?? "");
  assert.ok(cookie, "session cookie set");

  const me = await request(server).get("/auth/me").set("Cookie", cookie).expect(200);
  assert.equal(me.body.address, account.address.toLowerCase());
});

test("verify?bearer=1 returns a token usable as Authorization: Bearer (agent parity, 067)", async () => {
  const server = app.getHttpServer();
  const { message, signature } = await signedSiwe();
  const verify = await request(server).post("/auth/verify?bearer=1").send({ message, signature }).expect(201);
  const token = verify.body.token as string;
  assert.ok(token, "bearer token returned in the body");

  const me = await request(server).get("/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
  assert.equal(me.body.address, account.address.toLowerCase());
});

test("nonce is single-use: replaying the same message+signature is rejected", async () => {
  const server = app.getHttpServer();
  const { message, signature } = await signedSiwe();
  await request(server).post("/auth/verify").send({ message, signature }).expect(201);
  // Same nonce again → consumed → 401.
  const replay = await request(server).post("/auth/verify").send({ message, signature });
  assert.equal(replay.status, 401);
});

test("idempotency: same key replays; same key + different body conflicts (409)", async () => {
  const server = app.getHttpServer();
  const { message, signature } = await signedSiwe();
  const verify = await request(server).post("/auth/verify").send({ message, signature }).expect(201);
  const raw = verify.headers["set-cookie"];
  const cookie = Array.isArray(raw) ? raw.join("; ") : (raw ?? "");
  const key = `idem-${Date.now()}`;

  const first = await request(server).put("/profiles/me").set("Cookie", cookie).set("Idempotency-Key", key).send({ displayName: "Alice" }).expect(200);
  assert.equal(first.body.displayName, "Alice");

  // Replay: same key + same body → memoized identical response.
  const replay = await request(server).put("/profiles/me").set("Cookie", cookie).set("Idempotency-Key", key).send({ displayName: "Alice" }).expect(200);
  assert.equal(replay.body.displayName, "Alice");

  // Same key + DIFFERENT body → 409 conflict.
  const conflict = await request(server).put("/profiles/me").set("Cookie", cookie).set("Idempotency-Key", key).send({ displayName: "Mallory" });
  assert.equal(conflict.status, 409);
});
