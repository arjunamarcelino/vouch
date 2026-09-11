-- apps/api operational constraints Prisma's DSL can't express (docs/plans §Deepening D + data-integrity
-- review). APPLIED after `prisma db push` via `pnpm --filter @vouch/db db:constraints`. Idempotent.
-- `app_role` is passed by the db:constraints script (defaults to vouch_app); the REVOKE runs as owner.

-- Lowercase-hex identity: every guard compares addresses lowercased, so a mixed-case row forks identity.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profile_addr_lc') THEN
    ALTER TABLE "UserProfile" ADD CONSTRAINT user_profile_addr_lc CHECK (address ~ '^0x[0-9a-f]{40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_metadata_addr_lc') THEN
    ALTER TABLE "JobMetadata" ADD CONSTRAINT job_metadata_addr_lc
      CHECK (("clientAddress" IS NULL OR "clientAddress" ~ '^0x[0-9a-f]{40}$')
         AND ("providerAddress" IS NULL OR "providerAddress" ~ '^0x[0-9a-f]{40}$'));
  END IF;
  -- txHash + selector shape (lowercased) so a mixed-case hash can't create duplicate tracking rows.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_tx_hash_lc') THEN
    ALTER TABLE "TrackedTransaction" ADD CONSTRAINT tracked_tx_hash_lc
      CHECK ("txHash" ~ '^0x[0-9a-f]{64}$' AND "functionSelector" ~ '^0x[0-9a-f]{8}$');
  END IF;
  -- Status/action vocabularies pinned at the DB (last line of defence against a buggy writer).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_tx_status_enum') THEN
    ALTER TABLE "TrackedTransaction" ADD CONSTRAINT tracked_tx_status_enum
      CHECK (status IN ('PENDING','CONFIRMED','FAILED','MISMATCH','REORGED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_tx_action_enum') THEN
    ALTER TABLE "TrackedTransaction" ADD CONSTRAINT tracked_tx_action_enum
      CHECK (action IN ('APPROVE','OPEN_JOB','ACCEPT','SUBMIT','EVAL','CLAIM','CANCEL','EXPIRE','WITHDRAW','RESOLVE_TIMEOUT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_state_enum') THEN
    ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT idempotency_state_enum
      CHECK (state IN ('LOCKED','COMPLETED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_reqhash_hex') THEN
    ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT idempotency_reqhash_hex
      CHECK ("requestHash" ~ '^0x?[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepared_intent_status_enum') THEN
    ALTER TABLE "PreparedIntent" ADD CONSTRAINT prepared_intent_status_enum
      CHECK (status IN ('PREPARED','SUBMITTED','ABANDONED'));
  END IF;
END $$;

-- DB backstop for the openJob double-fund bind: one OPEN_JOB prepareKey → at most one tracked tx.
-- A second distinct txHash under the same key collides here → the app surfaces IDEMPOTENCY_CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS tracked_tx_openjob_prepare_key
  ON "TrackedTransaction" ("prepareKey")
  WHERE action = 'OPEN_JOB' AND "prepareKey" IS NOT NULL;

-- Poller scan stays bounded as tracked-tx count grows (mirrors payment_intent_active_idx).
CREATE INDEX IF NOT EXISTS tracked_tx_pending_idx
  ON "TrackedTransaction" ("lastCheckedAt")
  WHERE status = 'PENDING';

-- Append-only feed: revoke row mutation from the app role so a compromised app credential can't
-- rewrite activity history. NOTE: demo/reset TRUNCATE must therefore run as the table OWNER, not app_role.
REVOKE UPDATE, DELETE ON "FeedEvent" FROM :"app_role";
