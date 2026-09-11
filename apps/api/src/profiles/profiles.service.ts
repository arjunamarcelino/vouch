import { Injectable } from "@nestjs/common";
import { getProfile, upsertProfile } from "@vouch/db";

export interface ProfileView {
  address: string;
  displayName: string;
  kind: string | null;
}

/** Offchain display-profile reads/writes (controller stays thin — review 065). */
@Injectable()
export class ProfilesService {
  async get(address: string): Promise<ProfileView> {
    const p = await getProfile(address);
    return { address, displayName: p?.displayName ?? "", kind: p?.kind ?? null };
  }

  async setDisplayName(address: string, displayName: string): Promise<ProfileView> {
    const p = await upsertProfile(address, displayName);
    return { address, displayName: p.displayName, kind: p.kind ?? null };
  }
}
