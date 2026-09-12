import { z } from "zod";
import { txActionSchema } from "@vouch/shared/schemas";

/**
 * Refresh-survivable pending-tx store (plan §tx hard rules). Keyed by `${address}:${chainId}` so an
 * account/chain switch never cross-contaminates. The blob holds ONLY routing state — never raw private
 * material or form drafts (security P1.7). `localStorage` is an untrusted boundary, so reads are
 * validated with Zod and the persisted `stage` is a resume HINT only (the real state is reconciled from
 * the chain/API on load).
 */
export const persistedTxSchema = z.object({
  action: txActionSchema,
  jobId: z.string().optional(),
  preparedId: z.string(),
  txHash: z.string().optional(),
  stage: z.enum(["submitted", "tracking"]),
  updatedAt: z.number(),
});
export type PersistedTx = z.infer<typeof persistedTxSchema>;

function key(address: string, chainId: number): string {
  return `vouch:pendingtx:${address.toLowerCase()}:${chainId}`;
}

export function savePendingTx(address: string, chainId: number, tx: PersistedTx): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(address, chainId), JSON.stringify(tx));
  } catch {
    // storage full / disabled — non-fatal; the flow still works in-memory this session.
  }
}

export function loadPendingTx(address: string, chainId: number): PersistedTx | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key(address, chainId));
  if (!raw) return null;
  try {
    const parsed = persistedTxSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearPendingTx(address: string, chainId: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(address, chainId));
  } catch {
    // ignore
  }
}
