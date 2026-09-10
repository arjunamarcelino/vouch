import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VouchError } from "@vouch/shared/errors";
import { jobRequestSchema, quoteCommitmentSchema, paymentActionSchema } from "@vouch/shared/schemas";
import type { AgentCore } from "./core";
import type { RestOptions } from "./rest";

/**
 * MCP adapter over the same AgentCore (plan §10.3). Full parity with REST (§0.6): every capability an
 * external agent needs is a tool. Reads carry readOnlyHint; the bond action carries destructiveHint +
 * idempotentHint and is only registered when manual pay is enabled. Tool errors mirror the REST
 * error surface as `{ isError, content }` with the VouchErrorCode.
 */

function ok(data: unknown) {
  const content = [{ type: "text" as const, text: JSON.stringify(data) }];
  // `structuredContent` must be a JSON object per the MCP spec — attach it only for plain objects; the
  // decision-trace tool returns an array, which falls back to text content (review 042).
  const isPlainObject = typeof data === "object" && data !== null && !Array.isArray(data);
  return isPlainObject ? { content, structuredContent: data as Record<string, unknown> } : { content };
}

function fail(err: unknown) {
  const code = err instanceof VouchError ? err.code : "INTERNAL";
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }] };
}

async function guard(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

export function createMcpServer(core: AgentCore, opts: RestOptions = {}): McpServer {
  const server = new McpServer({ name: "vouch-assurance-agent", version: "1.0.0" });

  server.registerTool(
    "assurance_request_quote",
    {
      title: "Request assurance quote",
      description: "Score a provider+job from live subgraph data and return a signed, expiring quote. Read-only (no funds move).",
      inputSchema: jobRequestSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, extra) => guard(() => core.requestQuote(args, String(extra.requestId ?? "mcp"))),
  );

  server.registerTool(
    "assurance_verify_quote",
    {
      title: "Verify a quote",
      description: "Verify a signed quote against the job terms: replay/expiry/tamper/signer/chain. Pure.",
      inputSchema: { commitment: quoteCommitmentSchema, job: jobRequestSchema },
      annotations: { readOnlyHint: true },
    },
    async (args) => guard(() => core.verifyQuote(args.commitment, args.job)),
  );

  server.registerTool(
    "assurance_get_quote",
    {
      title: "Get a stored quote",
      description: "Fetch a previously issued signed quote by id.",
      inputSchema: { quote_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => guard(async () => (await core.getQuote(args.quote_id)) ?? { error: "NOT_FOUND" }),
  );

  server.registerTool(
    "assurance_get_transaction_status",
    {
      title: "Get transaction status",
      description: "Look up a payment intent (and its on-chain status) by idempotency key.",
      inputSchema: { idempotency_key: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => guard(async () => (await core.getTransactionStatus(args.idempotency_key)) ?? { error: "NOT_FOUND" }),
  );

  server.registerTool(
    "assurance_get_decision_trace",
    {
      title: "Get decision trace",
      description: "Fetch the hash-chained decision log for a quote (audit/demo).",
      inputSchema: { quote_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => guard(() => core.getDecisionTrace(args.quote_id)),
  );

  server.registerTool(
    "assurance_get_health",
    {
      title: "Agent health",
      description: "Report subgraph freshness and whether the wallet is configured.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => guard(() => core.getHealth()),
  );

  if (opts.allowManualPay) {
    server.registerTool(
      "assurance_execute_payment",
      {
        title: "Execute bond payment",
        description: "Post or refund the quote bond. Amount+destination are re-derived from the stored quote; idempotent.",
        inputSchema: { quote_id: z.string(), action: paymentActionSchema },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args, extra) => guard(() => core.executePayment(args.quote_id, args.action, String(extra.requestId ?? "mcp"))),
    );
  }

  return server;
}

/** Connect the MCP server over stdio (blocks). */
export async function startMcpStdio(core: AgentCore, opts: RestOptions = {}): Promise<void> {
  const server = createMcpServer(core, opts);
  await server.connect(new StdioServerTransport());
}
