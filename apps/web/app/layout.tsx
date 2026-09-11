import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import "./globals.css";
import { getConfig } from "../lib/wagmi";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Vouch — Confidential Outcome Assurance",
  description:
    "Provider-funded, capped performance guarantees for AI-agent work, verified confidentially after payment.",
};

/**
 * Root layout (Server Component). Reads the request cookie and computes the wagmi `initialState` so the
 * client hydrates without a wallet-connection flash (plan §RI-1). `headers()` is ASYNC in Next 16 — the
 * synchronous access removed in 15 is gone, so we `await` it. The `.dark` theme class is toggled
 * client-side later; default is the light "settlement-desk" theme.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const initialState = cookieToInitialState(getConfig(), (await headers()).get("cookie"));

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-surface text-foreground antialiased">
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
