import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";

const CLIENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROVIDER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const STRANGER = "0xcccccccccccccccccccccccccccccccccccccccc";

before(() => {
  process.env.CHAIN_ENV = "development";
  process.env.ADMIN_ADDRESSES = CLIENT;
});

function ctxWith(req: unknown, meta?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => meta,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const reflectorReturning = (v: unknown) => ({ getAllAndOverride: () => v }) as never;

test("AuthGuard sets req.user from a valid session, rejects when absent", async () => {
  const { AuthGuard } = await import("./auth.guard");
  const jwt = { verify: (t: string) => (t === "good" ? { sub: CLIENT.toUpperCase() } : (() => { throw new Error("bad"); })()) };
  const guard = new AuthGuard(jwt as never);

  const req: { cookies: Record<string, string>; headers: Record<string, string>; user?: { address: string } } = {
    cookies: { "__Host-vouch_session": "good" },
    headers: {},
  };
  assert.equal(guard.canActivate(ctxWith(req)), true);
  assert.equal(req.user?.address, CLIENT); // lowercased

  assert.throws(() => guard.canActivate(ctxWith({ cookies: {}, headers: {} })), /No session/);
  assert.throws(
    () => guard.canActivate(ctxWith({ cookies: { "__Host-vouch_session": "bad" }, headers: {} })),
    /Invalid session/,
  );
});

test("AuthGuard accepts a Bearer token (agent-native parity)", async () => {
  const { AuthGuard } = await import("./auth.guard");
  const jwt = { verify: () => ({ sub: PROVIDER }) };
  const guard = new AuthGuard(jwt as never);
  const req: { headers: Record<string, string>; user?: { address: string } } = {
    headers: { authorization: "Bearer good" },
  };
  assert.equal(guard.canActivate(ctxWith(req)), true);
  assert.equal(req.user?.address, PROVIDER);
});

test("RolesGuard: ADMIN allowlist grants; unknown role denies", async () => {
  const { RolesGuard } = await import("./roles.guard");
  const guard = new RolesGuard(reflectorReturning(["ADMIN"]), {} as never);
  assert.equal(await guard.canActivate(ctxWith({ user: { address: CLIENT } }, {})), true);
  await assert.rejects(guard.canActivate(ctxWith({ user: { address: STRANGER } }, {})), /Missing required role/);
});

test("RolesGuard: EVALUATOR via on-chain hasRole; fail-closed on RPC error", async () => {
  const { RolesGuard } = await import("./roles.guard");
  const okChain = { evaluatorRole: async () => "0xrole", hasRole: async () => true };
  const okGuard = new RolesGuard(reflectorReturning(["EVALUATOR"]), okChain as never);
  assert.equal(await okGuard.canActivate(ctxWith({ user: { address: PROVIDER } }, {})), true);

  const downChain = { evaluatorRole: async () => { throw new Error("rpc down"); }, hasRole: async () => true };
  const downGuard = new RolesGuard(reflectorReturning(["EVALUATOR"]), downChain as never);
  await assert.rejects(downGuard.canActivate(ctxWith({ user: { address: PROVIDER } }, {})), /Role check unavailable/);
});

test("JobPartyGuard: only the matching party passes; cross-tenant is FORBIDDEN", async () => {
  const { JobPartyGuard } = await import("./job-party.guard");
  const chain = { getJob: async () => ({ client: CLIENT, provider: PROVIDER }) };
  const guard = new JobPartyGuard(reflectorReturning("client"), chain as never);

  const okReq = { params: { jobId: "1" }, user: { address: CLIENT }, job: undefined };
  assert.equal(await guard.canActivate(ctxWith(okReq, {})), true);

  await assert.rejects(
    guard.canActivate(ctxWith({ params: { jobId: "1" }, user: { address: STRANGER } }, {})),
    /not the job client/,
  );
});
