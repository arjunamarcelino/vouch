import { pino, type Logger, type LoggerOptions } from "pino";

/**
 * Structured JSON logger factory with secret redaction.
 *
 * NEVER log private evaluation criteria, private tests, repo credentials, or
 * secrets (plan §11 / §17.6). The redaction paths below are a safety net, not a
 * license to pass secrets through logs.
 */
const REDACT_PATHS = [
  "*.apiKey",
  "*.entitySecret",
  "*.privateKey",
  "*.token",
  "*.authorization",
  "*.password",
  "req.headers.authorization",
];

export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    ...options,
  });
}

export type { Logger };
