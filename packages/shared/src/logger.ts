import { pino, destination, type Logger, type LoggerOptions } from "pino";

/**
 * Structured JSON logger factory with secret redaction.
 *
 * NEVER log private evaluation criteria, private tests, repo credentials, or
 * secrets (plan §11 / §17.6). The redaction paths below are a safety net, not a
 * license to pass secrets through logs.
 */
export const REDACT_PATHS = [
  "*.apiKey",
  "*.entitySecret",
  "*.privateKey",
  "*.token",
  "*.authorization",
  "*.password",
  "req.headers.authorization",
  // Agent secret env keys (review 039): the parsed env object uses these exact names, which none of the
  // suffix patterns above match. Cover both top-level and one-level-nested (e.g. { env: {...} }) shapes.
  "CIRCLE_API_KEY",
  "CIRCLE_ENTITY_SECRET",
  "QUOTE_SIGNER_PK",
  "*.CIRCLE_API_KEY",
  "*.CIRCLE_ENTITY_SECRET",
  "*.QUOTE_SIGNER_PK",
];

export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  const base = {
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    ...options,
  };
  // In MCP stdio mode, stdout carries the JSON-RPC framing — logs must go to stderr (fd 2) or they
  // corrupt the protocol (review 040). Read at logger-creation time (env is set before import).
  return process.env.AGENT_TRANSPORT === "mcp" ? pino(base, destination(2)) : pino(base);
}

export type { Logger };
