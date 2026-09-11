import { Global, Module } from "@nestjs/common";
import { ChainService } from "./chain/chain.service";
import { IdempotencyInterceptor } from "./idempotency/idempotency.interceptor";

/**
 * Shared substrate available app-wide (Global so it isn't re-imported per feature module). ChainService
 * is a singleton (one viem client); IdempotencyInterceptor is applied per-route. (LoggingInterceptor is
 * registered globally via APP_INTERCEPTOR in AppModule — not here; review 071.)
 */
@Global()
@Module({
  providers: [ChainService, IdempotencyInterceptor],
  exports: [ChainService, IdempotencyInterceptor],
})
export class CommonModule {}
