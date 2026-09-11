import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArgumentsHost } from "@nestjs/common";
import { VouchError } from "@vouch/shared/errors";
import { VouchErrorFilter } from "./vouch-error.filter";
import { ApiError } from "./errors";

function fakeHost(): { host: ArgumentsHost; captured: { code?: number; body?: unknown } } {
  const captured: { code?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.code = code;
      return {
        json(body: unknown) {
          captured.body = body;
        },
      };
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { host, captured };
}

test("VouchError SUBGRAPH_STALE → 503 with real message", () => {
  const { host, captured } = fakeHost();
  new VouchErrorFilter().catch(new VouchError("SUBGRAPH_STALE", "12 blocks behind"), host);
  assert.equal(captured.code, 503);
  assert.deepEqual(captured.body, { error: "SUBGRAPH_STALE", message: "12 blocks behind" });
});

test("ApiError UNAUTHORIZED → 401", () => {
  const { host, captured } = fakeHost();
  new VouchErrorFilter().catch(new ApiError("UNAUTHORIZED", "No session"), host);
  assert.equal(captured.code, 401);
  assert.equal((captured.body as { error: string }).error, "UNAUTHORIZED");
});

test("ApiError IDEMPOTENCY_CONFLICT → 409", () => {
  const { host, captured } = fakeHost();
  new VouchErrorFilter().catch(new ApiError("IDEMPOTENCY_CONFLICT", "dup"), host);
  assert.equal(captured.code, 409);
});

test("masked codes hide internal detail", () => {
  const { host, captured } = fakeHost();
  new VouchErrorFilter().catch(new ApiError("CRE_RESULT_MALFORMED", "secret internal detail"), host);
  assert.equal(captured.code, 502);
  assert.equal((captured.body as { message: string }).message, "Service temporarily unavailable");
});
