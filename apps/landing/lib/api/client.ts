import { z } from "zod";
import { parseOrThrow, apiErrorEnvelopeSchema } from "@vouch/shared/schemas";
import { apiUrl } from "../env";

/**
 * Typed REST client for `apps/api`. (1) Every request sends the SIWE cookie via
 * `credentials: "include"`, and (2) HTTP status + the `{ error, message }` envelope map to a typed
 * `ApiClientError` so the UI renders actionable states (401 session / 403 role-party / 404 / 409
 * conflict / 503 degraded) instead of a raw status code. Responses are validated at the boundary with
 * the shared Zod schemas (`parseOrThrow`) so `z.infer` types flow through TanStack Query. The web app
 * NEVER sends `?bearer=1` and NEVER stores a token — the session is the httpOnly cookie only.
 */

/** A failed API call, carrying the HTTP status and the server's error code for typed UI branching. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
  /** No session / session expired — the UI should prompt SIWE re-auth. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  /** A critical integration is degraded (e.g. subgraph stale) — fail-closed, never fabricate. */
  get isDegraded(): boolean {
    return this.status === 503;
  }
}

async function toError(res: Response): Promise<ApiClientError> {
  let code = `HTTP_${res.status}`;
  let message = res.statusText || "Request failed";
  try {
    const parsed = apiErrorEnvelopeSchema.safeParse(await res.json());
    if (parsed.success) {
      code = parsed.data.error;
      message = parsed.data.message;
    }
  } catch {
    // non-JSON body — keep the status-derived defaults
  }
  return new ApiClientError(res.status, code, message);
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  what: string,
  opts?: { body?: unknown; idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await fetch(apiUrl(path), {
    method,
    credentials: "include",
    cache: "no-store",
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw await toError(res);
  return parseOrThrow(schema, await res.json(), what);
}

export function apiGet<T>(path: string, schema: z.ZodType<T>, what: string): Promise<T> {
  return request("GET", path, schema, what);
}

export function apiPost<T>(
  path: string,
  schema: z.ZodType<T>,
  what: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  return request("POST", path, schema, what, { body, idempotencyKey });
}
