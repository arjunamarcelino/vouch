"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Thin wrapper over RainbowKit's ConnectButton tuned for the restrained B2B look: no balance, a compact
 * chain icon, and full account/chain/SIWE state handled by RainbowKit + our auth adapter. Kept as a
 * named component so pages import a stable surface rather than RainbowKit directly.
 *
 * `compact` (review 112): avatar-only, no chain pill — fits the collapsed app sidebar rail so the
 * account/disconnect control stays reachable when labels are hidden.
 */
export function WalletConnectButton({ compact = false }: { compact?: boolean }) {
  return (
    <ConnectButton
      showBalance={false}
      chainStatus={compact ? "none" : "icon"}
      accountStatus={compact ? "avatar" : { smallScreen: "avatar", largeScreen: "full" }}
    />
  );
}
