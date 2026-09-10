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
  | "NOT_IMPLEMENTED"
  // --- agent quotation & settlement (plan §9.2) ---
  // Thrown when a quote is used at ACTION time and fails verification. The returned verify-time
  // reason codes (QUOTE_EXPIRED / QUOTE_REPLAY / JOB_PARAMS_ALTERED / …) are carried in `cause`;
  // verifyQuote itself returns them as data and does NOT throw (see ./reasonCodes).
  | "QUOTE_INVALID"
  // Payment executor guards (plan §6).
  | "SPEND_POLICY_VIOLATION"
  | "WRONG_CONTRACT"
  | "DUPLICATE_SUBMISSION";

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

/**
 * Thrown when a quote is CONSUMED at action time but fails verification. `reasonCodes` carries the
 * pure-verifier verdict (expired / replay / altered / bad-signer / chain-mismatch). verifyQuote
 * itself returns these as data; only the action path (executor) throws.
 */
export class QuoteInvalidError extends VouchError {
  readonly reasonCodes: readonly string[];

  constructor(reasonCodes: readonly string[], message?: string) {
    super("QUOTE_INVALID", message ?? `Quote invalid: ${reasonCodes.join(", ")}`, reasonCodes);
    this.name = "QuoteInvalidError";
    this.reasonCodes = reasonCodes;
  }
}

/** Thrown by the spend-policy gate before a transfer is constructed (plan §6.2). */
export class SpendPolicyViolationError extends VouchError {
  readonly reasonCodes: readonly string[];

  constructor(reasonCodes: readonly string[]) {
    super("SPEND_POLICY_VIOLATION", `Spend policy violation: ${reasonCodes.join(", ")}`, reasonCodes);
    this.name = "SpendPolicyViolationError";
    this.reasonCodes = reasonCodes;
  }
}
