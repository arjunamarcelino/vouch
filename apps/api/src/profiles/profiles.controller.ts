import { Body, Controller, Get, Put, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { z } from "zod";
import { parseOrThrow } from "@vouch/shared/schemas";
import { getProfile, upsertProfile } from "@vouch/db";
import { AuthGuard } from "../auth/guards/auth.guard";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import type { SessionUser } from "../auth/roles";

const updateProfileSchema = z
  .object({ displayName: z.string().max(80) }) // bounded length (stored-XSS defense-in-depth)
  .strict();

interface ProfileView {
  address: string;
  displayName: string;
  kind: string | null;
}

/** Offchain display profile for the session address. Address is the identity; this is cosmetic only. */
@Controller("profiles")
@UseGuards(AuthGuard)
export class ProfilesController {
  @Get("me")
  async getMine(@Req() req: { user: SessionUser }): Promise<ProfileView> {
    const p = await getProfile(req.user.address);
    return { address: req.user.address, displayName: p?.displayName ?? "", kind: p?.kind ?? null };
  }

  @Put("me")
  @UseInterceptors(IdempotencyInterceptor)
  async updateMine(@Req() req: { user: SessionUser }, @Body() body: unknown): Promise<ProfileView> {
    const { displayName } = parseOrThrow(updateProfileSchema, body, "profile update");
    const p = await upsertProfile(req.user.address, displayName);
    return { address: req.user.address, displayName: p.displayName, kind: p.kind ?? null };
  }
}
