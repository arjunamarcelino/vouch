import { Controller, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { DemoService } from "./demo.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import { Roles } from "../auth/roles";

/**
 * Admin demo tooling — offchain operational state only (admin has NO fund-seizure authority; there is
 * no value-moving route here). Double-gated: ADMIN role (allowlist) AND the DemoService allowlist.
 */
@Controller("demo")
@Roles("ADMIN")
@UseGuards(AuthGuard, RolesGuard)
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post("reset")
  @UseInterceptors(IdempotencyInterceptor)
  reset(): Promise<unknown> {
    return this.demo.reset();
  }

  @Post("seed")
  @UseInterceptors(IdempotencyInterceptor)
  seed(): Promise<unknown> {
    return this.demo.seed();
  }
}
