import pRetry, { AbortError } from "p-retry";
import pTimeout from "p-timeout";

/**
 * Bounded, explicit-timeout RPC/network primitives (performance + viem review). Every chain/agent call
 * goes through these so one flaky dependency can't hang a request or blow the retry budget.
 *
 * Retry ONLY transient faults; a semantic failure (TX_MISMATCH / TX_REVERTED / wrong-event) must abort
 * immediately via `AbortError` — never burn the budget re-running a deterministic failure.
 */

export interface ResilientOptions {
  timeoutMs: number;
  retries: number;
  /** Return true for transient faults worth retrying (timeouts / 429 / 5xx / conn reset). */
  isTransient?: (err: unknown) => boolean;
  label?: string;
}

/** A marker services throw (or wrap) to stop retries immediately for a deterministic failure. */
export class NonRetryableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "NonRetryableError";
    this.cause = cause;
  }
}

const DEFAULT_TRANSIENT = (err: unknown): boolean => {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof NonRetryableError) return false;
  return (
    /timeout|timed out/i.test(msg) ||
    /HttpRequestError|TimeoutError|RpcRequestError/i.test(name) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(msg) ||
    / 429| 502| 503| 504/.test(msg)
  );
};

/** Run `fn` with a per-attempt hard timeout and bounded exponential-backoff retries (transient only). */
export async function resilient<T>(fn: () => Promise<T>, opts: ResilientOptions): Promise<T> {
  const isTransient = opts.isTransient ?? DEFAULT_TRANSIENT;
  return pRetry(
    async () => {
      try {
        return await pTimeout(fn(), { milliseconds: opts.timeoutMs });
      } catch (err) {
        // Semantic / non-transient → stop now, surface the original error unchanged.
        if (!isTransient(err)) throw new AbortError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
    { retries: opts.retries, factor: 2, minTimeout: 200, maxTimeout: 2_000 },
  );
}

/** A single bounded-timeout call with no retries (e.g. health probes). */
export async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return pTimeout(fn(), { milliseconds: timeoutMs });
}
