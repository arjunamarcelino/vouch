import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";

/**
 * Request correlation via Node's built-in AsyncLocalStorage (no nestjs-cls dependency — simplicity +
 * pattern-consistency review). The id spans web → api → agent when propagated on the outbound
 * `x-correlation-id` header (the agent's REST core already reads that exact header).
 */

interface RequestContext {
  correlationId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

/** The current request's correlation id, or a `-` sentinel outside a request. */
export function correlationId(): string {
  return als.getStore()?.correlationId ?? "-";
}

const HEADER = "x-correlation-id";
// Log-injection defense: only accept a well-formed inbound id; otherwise generate a fresh one.
const SAFE = /^[A-Za-z0-9._-]{1,128}$/u;

interface MinReq {
  headers: Record<string, string | string[] | undefined>;
}
interface MinRes {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: MinReq, res: MinRes, next: () => void): void {
    const raw = req.headers[HEADER];
    const inbound = Array.isArray(raw) ? raw[0] : raw;
    const id = inbound && SAFE.test(inbound) ? inbound : randomUUID();
    res.setHeader(HEADER, id);
    als.run({ correlationId: id }, () => next());
  }
}
