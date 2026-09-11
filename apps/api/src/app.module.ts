import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AppController } from "./app.controller";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { GraphModule } from "./graph/graph.module";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { AgentModule } from "./agent/agent.module";
import { CorrelationMiddleware } from "./common/correlation/correlation";
import { LoggingInterceptor } from "./common/logging/logging.interceptor";

@Module({
  imports: [
    CommonModule,
    AuthModule,
    ProfilesModule,
    GraphModule,
    HealthModule,
    JobsModule,
    TransactionsModule,
    AgentModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation id spans every request (AsyncLocalStorage); mounted first so logs/outbound carry it.
    consumer.apply(CorrelationMiddleware).forRoutes("*");
  }
}
