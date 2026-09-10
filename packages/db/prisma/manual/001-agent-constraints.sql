-- Raw constraints Prisma's schema DSL can't express (plan §0.5 / data-integrity review).
-- Apply AFTER `prisma migrate deploy` creates the agent tables. Tracked here so the
-- guarantees are reviewable; wiring into a real migration is a §13 blocking-checklist item
-- (needs DATABASE_URL + a running Postgres).

-- Money columns are integer base-unit strings; enforce the domain at the DB (last line of
-- defence against a buggy writer — the cap SUM casts amount::numeric).
ALTER TABLE "PaymentIntent" ADD CONSTRAINT payment_intent_amount_uint
  CHECK (amount ~ '^[0-9]+$');
ALTER TABLE "Quote" ADD CONSTRAINT quote_amounts_uint
  CHECK ("recommendedGuaranteeLimit" ~ '^[0-9]+$'
     AND "assuranceServiceFee" ~ '^[0-9]+$'
     AND "minProviderCollateral" ~ '^[0-9]+$');

-- Partial index backing the rolling daily-cap SUM over in-flight + settled intents.
CREATE INDEX IF NOT EXISTS payment_intent_active_idx
  ON "PaymentIntent" (status)
  WHERE status NOT IN ('FAILED', 'ABANDONED');

-- Tamper-evidence: the decision log is append-only. Revoke mutation at the app DB role
-- (replace vouch_app with the actual role). The UNIQUE(quoteId, prevRecordHash) +
-- UNIQUE(quoteId, seq) constraints (in schema.prisma) DB-enforce chain linearization.
-- REVOKE UPDATE, DELETE ON "DecisionTrace" FROM vouch_app;
