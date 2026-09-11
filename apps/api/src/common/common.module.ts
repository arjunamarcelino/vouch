import { Global, Module } from "@nestjs/common";
import { ChainService } from "./chain/chain.service";
import { IdempotencyInterceptor } from "./idempotency/idempotency.interceptor";
import { LoggingInterceptor } from "./logging/logging.interceptor";

/**
 * Shared substrate available app-wide (Global so it isn't re-imported per feature module — the
 * pattern-consistency fix for the previous per-module provider duplication). ChainService is a
 * singleton (one viem client). The interceptors are provided here and applied per-route or globally.
 */
@Global()
@Module({
  providers: [ChainService, IdempotencyInterceptor, LoggingInterceptor],
  exports: [ChainService, IdempotencyInterceptor, LoggingInterceptor],
})
export class CommonModule {}
