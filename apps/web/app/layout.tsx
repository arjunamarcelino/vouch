import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import "./globals.css";
import { getConfig } from "../lib/wagmi";
import { Providers } from "./providers";
import { SiteHeader } from "../components/shell/SiteHeader";

export const metadata: Metadata = {
  title: "Vouch — Confidential Outcome Assurance",
  description:
    "Provider-funded, capped performance guarantees for AI-agent work, verified confidentially after payment.",
  // Favicon set (files live in apps/web/public/). Next renders the <link>/<meta> tags — do NOT
  // hand-edit <head> in the App Router.
  icons: {
    icon: [
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  appleWebApp: { title: "Vouch" },
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
      <body className="min-h-dvh bg-surface text-foreground antialiased">
        <Providers initialState={initialState}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
