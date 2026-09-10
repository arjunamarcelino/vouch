import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { VouchError, type VouchErrorCode } from "@vouch/shared/errors";
import { jobRequestSchema, quoteCommitmentSchema, paymentActionSchema } from "@vouch/shared/schemas";
import { createLogger } from "@vouch/shared/logger";
import type { AgentCore } from "./core";

/**
 * REST adapter over the transport-agnostic AgentCore (plan §10.2). Thin: validates raw input with the
 * shared zod schemas, calls core, maps thrown VouchErrors to HTTP via the ONE exhaustive status table.
 * No business logic lives here.
 */

const log = createLogger("agent-rest");

// The single exhaustive VouchErrorCode → HTTP status map (compile error if a code is missing).
const HTTP_STATUS = {
  CONFIG_INVALID: 500,
  CHAIN_NOT_CONFIGURED: 500,
  SUBGRAPH_UNAVAILABLE: 503,
  SUBGRAPH_STALE: 503,
  SUBGRAPH_LAGGING: 503,
  VALIDATION_FAILED: 400,
  NOT_IMPLEMENTED: 501,
  QUOTE_INVALID: 400,
  SPEND_POLICY_VIOLATION: 403,
  WRONG_CONTRACT: 500,
  DUPLICATE_SUBMISSION: 409,
} satisfies Record<VouchErrorCode, number>;

export interface RestOptions {
  /** Gate the destructive pay endpoint (§0.6). Default false: production runs autonomous-only. */
  allowManualPay?: boolean;
}

export function createRestServer(core: AgentCore, opts: RestOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: Error & { validation?: unknown }, _req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: "VALIDATION_FAILED", message: err.message });
    }
    if (err instanceof VouchError) {
      const status = HTTP_STATUS[err.code];
      const internal = err.code === "CONFIG_INVALID" || err.code === "CHAIN_NOT_CONFIGURED" || err.code === "WRONG_CONTRACT";
      return reply.code(status).send({ error: err.code, message: internal ? "Internal error" : err.message });
    }
    log.error({ err: err.message }, "unhandled error");
    return reply.code(500).send({ error: "INTERNAL", message: "Internal error" });
  });

  app.get("/health", async () => core.getHealth());

  app.post("/quotes", { schema: { body: jobRequestSchema } }, async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    const commitment = await core.requestQuote(req.body, correlationId);
    return reply.code(201).send(commitment);
  });

  app.post(
    "/quotes/verify",
    { schema: { body: z.object({ commitment: quoteCommitmentSchema, job: jobRequestSchema }) } },
    async (req) => core.verifyQuote(req.body.commitment, req.body.job),
  );

  app.get(
    "/quotes/:quoteId",
    { schema: { params: z.object({ quoteId: z.string() }) } },
    async (req, reply) => {
      const q = await core.getQuote(req.params.quoteId);
      return q ? q : reply.code(404).send({ error: "NOT_FOUND" });
    },
  );

  app.get(
    "/tx/:key",
    { schema: { params: z.object({ key: z.string() }) } },
    async (req, reply) => {
      const intent = await core.getTransactionStatus(req.params.key);
      return intent ? intent : reply.code(404).send({ error: "NOT_FOUND" });
    },
  );

  app.get(
    "/traces/:quoteId",
    { schema: { params: z.object({ quoteId: z.string() }) } },
    async (req) => core.getDecisionTrace(req.params.quoteId),
  );

  if (opts.allowManualPay) {
    app.post(
      "/quotes/:quoteId/pay",
      { schema: { params: z.object({ quoteId: z.string() }), body: z.object({ action: paymentActionSchema }) } },
      async (req) => core.executePayment(req.params.quoteId, req.body.action, req.id),
    );
  }

  return app;
}
