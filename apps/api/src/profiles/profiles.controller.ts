import { Body, Controller, Get, Put, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { z } from "zod";
import { parseOrThrow } from "@vouch/shared/schemas";
import { ProfilesService, type ProfileView } from "./profiles.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import type { SessionUser } from "../auth/roles";

const updateProfileSchema = z
  .object({ displayName: z.string().max(80) }) // bounded length (stored-XSS defense-in-depth)
  .strict();

/** Offchain display profile for the session address. Address is the identity; this is cosmetic only. */
@Controller("profiles")
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get("me")
  getMine(@Req() req: { user: SessionUser }): Promise<ProfileView> {
    return this.profiles.get(req.user.address);
  }

  @Put("me")
  @UseInterceptors(IdempotencyInterceptor)
  updateMine(@Req() req: { user: SessionUser }, @Body() body: unknown): Promise<ProfileView> {
    const { displayName } = parseOrThrow(updateProfileSchema, body, "profile update");
    return this.profiles.setDisplayName(req.user.address, displayName);
  }
}
