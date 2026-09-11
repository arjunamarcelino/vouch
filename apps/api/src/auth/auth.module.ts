import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv } from "../config/env";
import { AuthGuard } from "./guards/auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { JobPartyGuard } from "./guards/job-party.guard";
import { AgentKeyGuard } from "./guards/agent-key.guard";

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
      secret: loadEnv().SESSION_SECRET ?? "dev-insecure-secret-please-set-SESSION_SECRET",
      signOptions: { expiresIn: loadEnv().SESSION_TTL_SECONDS, algorithm: "HS256" },
    }),
  ],
  providers: [AuthGuard, RolesGuard, JobPartyGuard, AgentKeyGuard],
  exports: [AuthGuard, RolesGuard, JobPartyGuard, AgentKeyGuard, JwtModule],
})
export class AuthModule {}
