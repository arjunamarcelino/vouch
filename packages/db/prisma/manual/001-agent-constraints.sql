-- Raw constraints Prisma's schema DSL can't express (plan §0.5 / data-integrity + security review 036).
-- APPLIED as a real deploy step: `pnpm --filter @vouch/db db:constraints` (psql), run AFTER
-- `prisma db push` / `migrate deploy` creates the agent tables. Idempotent (safe to re-run).
--
-- Why a script, not a Prisma migration: this repo has no migration history (uses `db push`), so a
-- partial hand-authored migration referencing these tables can't be verified without a live baseline.
-- If/when the project adopts `prisma migrate`, fold this SQL into the generated migration.

-- Money columns are integer base-unit strings; enforce the domain at the DB (last line of defence
-- against a buggy writer — the rolling-cap SUM casts amount::numeric).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_intent_amount_uint') THEN
    ALTER TABLE "PaymentIntent" ADD CONSTRAINT payment_intent_amount_uint CHECK (amount ~ '^[0-9]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_amounts_uint') THEN
    ALTER TABLE "Quote" ADD CONSTRAINT quote_amounts_uint
      CHECK ("recommendedGuaranteeLimit" ~ '^[0-9]+$'
         AND "assuranceServiceFee" ~ '^[0-9]+$'
         AND "minProviderCollateral" ~ '^[0-9]+$');
  END IF;
END $$;

-- Partial index backing the ROLLING 24h daily-cap SUM (WHERE status NOT IN (...) AND createdAt >= ...).
-- Indexed on createdAt so the windowed scan stays bounded as lifetime intent count grows.
CREATE INDEX IF NOT EXISTS payment_intent_active_idx
  ON "PaymentIntent" ("createdAt")
  WHERE status NOT IN ('FAILED', 'ABANDONED');

-- Tamper-evidence: the decision log is append-only. Revoke row mutation from the app role so a
-- compromised app credential can't rewrite audit history (the UNIQUE(quoteId,prevRecordHash)/(seq)
-- constraints in schema.prisma prevent forks; this makes rows immutable). `app_role` is passed by the
-- db:constraints script (defaults to vouch_app). Run as the table owner / a superuser.
REVOKE UPDATE, DELETE ON "DecisionTrace" FROM :"app_role";
