import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { GraphModule } from "./graph/graph.module";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { ClaimsModule } from "./claims/claims.module";
import { FeedModule } from "./feed/feed.module";
import { DemoModule } from "./demo/demo.module";
import { AgentModule } from "./agent/agent.module";
import { CorrelationMiddleware } from "./common/correlation/correlation";
import { LoggingInterceptor } from "./common/logging/logging.interceptor";
import { loadEnv } from "./config/env";

const env = loadEnv();

@Module({
  imports: [
    // Global rate limit off the existing env (review 056). ttl in ms (throttler v6).
    ThrottlerModule.forRoot([{ ttl: env.THROTTLE_TTL_SECONDS * 1000, limit: env.THROTTLE_LIMIT }]),
    CommonModule,
    AuthModule,
    ProfilesModule,
    GraphModule,
    HealthModule,
    JobsModule,
    TransactionsModule,
    ClaimsModule,
    FeedModule,
    DemoModule,
    AgentModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation id spans every request (AsyncLocalStorage); mounted first so logs/outbound carry it.
    consumer.apply(CorrelationMiddleware).forRoutes("*");
  }
}
