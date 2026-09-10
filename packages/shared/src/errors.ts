/**
 * Explicit, typed error taxonomy for the Vouch TypeScript surface.
 *
 * Single paradigm (plan §17.7-8): thrown typed error classes at boundaries.
 * `apps/api` maps these via a global exception filter; the agent surfaces them
 * in structured logs. No `neverthrow` result-plumbing.
 */

export type VouchErrorCode =
  | "CONFIG_INVALID"
  | "CHAIN_NOT_CONFIGURED"
  | "SUBGRAPH_UNAVAILABLE"
  | "SUBGRAPH_STALE"
  | "SUBGRAPH_LAGGING"
  | "VALIDATION_FAILED"
  | "NOT_IMPLEMENTED";

export class VouchError extends Error {
  readonly code: VouchErrorCode;

  constructor(code: VouchErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "VouchError";
    this.code = code;
  }
}

/** Thrown by placeholder sponsor integrations that are intentionally not wired yet. */
export class NotImplementedError extends VouchError {
  constructor(what: string) {
    super("NOT_IMPLEMENTED", `Not implemented yet: ${what}`);
    this.name = "NotImplementedError";
  }
}

export class ConfigInvalidError extends VouchError {
  constructor(message: string, cause?: unknown) {
    super("CONFIG_INVALID", message, cause);
    this.name = "ConfigInvalidError";
  }
}
