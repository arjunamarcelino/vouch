import { SetMetadata } from "@nestjs/common";
import type { Role } from "@vouch/shared/schemas";

/**
 * Two independent authorization axes, kept as SEPARATE guards so routes compose them (SIWE deep-dive):
 *  - `@Roles(...)` → RolesGuard: global grants (ADMIN allowlist, on-chain EVALUATOR_ROLE).
 *  - `@JobParty(side)` → JobPartyGuard: per-resource (session.address === job.client / job.provider).
 * CLIENT/PROVIDER are contextual, so they're expressed via `@JobParty`, not `@Roles`.
 */

export const ROLES_KEY = "vouch:roles";
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

export const JOB_PARTY_KEY = "vouch:jobParty";
export type JobPartySide = "client" | "provider" | "any";
export const JobParty = (side: JobPartySide): MethodDecorator & ClassDecorator =>
  SetMetadata(JOB_PARTY_KEY, side);

export interface SessionUser {
  address: string; // lowercased 0x
}
