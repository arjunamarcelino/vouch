import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv, sessionSecret } from "../config/env";
import { AuthGuard } from "./guards/auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { JobPartyGuard } from "./guards/job-party.guard";
import { AgentKeyGuard } from "./guards/agent-key.guard";
import { AuthController } from "./auth.controller";
import { SiweService } from "./siwe.service";
import { SessionService } from "./session.service";

/**
 * Auth substrate (Global). Provides the four composable guards and the JwtService used to verify (and,
 * in Stream A, issue) SIWE sessions. Guard *implementations* live in Phase 0 — they depend only on
 * JwtService + ChainService, not on the SIWE issuance controllers (which land in Stream A).
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: sessionSecret(),
      signOptions: { expiresIn: loadEnv().SESSION_TTL_SECONDS, algorithm: "HS256" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthGuard, RolesGuard, JobPartyGuard, AgentKeyGuard, SiweService, SessionService],
  exports: [AuthGuard, RolesGuard, JobPartyGuard, AgentKeyGuard, JwtModule],
})
export class AuthModule {}
