"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Thin wrapper over RainbowKit's ConnectButton tuned for the restrained B2B look: no balance, a compact
 * chain icon, and full account/chain/SIWE state handled by RainbowKit + our auth adapter. Kept as a
 * named component so pages import a stable surface rather than RainbowKit directly.
 */
export function WalletConnectButton() {
  return (
    <ConnectButton
      showBalance={false}
      chainStatus="icon"
      accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
    />
  );
}
