import { Injectable } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { pruneIdempotency, pruneExpiredNonces } from "@vouch/db";
import { createLogger } from "@vouch/shared/logger";

/**
 * Bounded periodic GC for the operational tables that grow per-request (review 063). Without this the
 * `IdempotencyRecord` (one row per write) and `SiweNonce` (one per login attempt) grow unbounded and
 * bloat the indexes backing the idempotency claim path. Hourly is ample; the pruners are self-scoped
 * (COMPLETED > 72h / expired-lease idempotency; expired nonces).
 */
@Injectable()
export class MaintenanceService {
  private readonly log = createLogger("api:maintenance");

  @Interval("operational-gc", 3_600_000)
  async gc(): Promise<void> {
    try {
      const [idem, nonces] = await Promise.all([pruneIdempotency(), pruneExpiredNonces()]);
      if (idem || nonces) this.log.info({ idempotency: idem, nonces }, "operational GC pruned rows");
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, "operational GC failed");
    }
  }
}
