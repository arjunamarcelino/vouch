import { test, before } from "node:test";
import assert from "node:assert/strict";

const ADDR = "0xAbC0000000000000000000000000000000000001";

before(() => {
  process.env.CHAIN_ENV = "development";
  process.env.SESSION_SECRET = "x".repeat(40);
});

test("session JWT roundtrips: SessionService.sign → AuthGuard accepts → req.user", async () => {
  const { JwtService } = await import("@nestjs/jwt");
  const { SessionService } = await import("./session.service");
  const { AuthGuard } = await import("./guards/auth.guard");

  const jwt = new JwtService({});
  const session = new SessionService(jwt, {} as never);
  const token = session.sign(ADDR);
  assert.match(token, /^[\w-]+\.[\w-]+\.[\w-]+$/u); // JWT shape

  const guard = new AuthGuard(jwt);
  const req: { cookies: Record<string, string>; headers: Record<string, string>; user?: { address: string } } = {
    cookies: { "__Host-vouch_session": token },
    headers: {},
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
  assert.equal(guard.canActivate(ctx), true);
  assert.equal(req.user?.address, ADDR.toLowerCase());
});

test("cookie is httpOnly + SameSite=Strict; secure off in development", async () => {
  const { JwtService } = await import("@nestjs/jwt");
  const { SessionService } = await import("./session.service");
  const c = new SessionService(new JwtService({}), {} as never).cookie(ADDR);
  assert.equal(c.options.httpOnly, true);
  assert.equal(c.options.sameSite, "strict");
  assert.equal(c.options.secure, false); // development
  assert.equal(c.name, "__Host-vouch_session");
});
