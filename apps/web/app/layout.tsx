import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Typography. Plus Jakarta Sans is the primary voice — a modern geometric sans used for BOTH display
 * headlines (heavier, tight tracking — see the `.font-display` weight rule in globals.css) and body/UI,
 * so the two "match" by being one family. Geist Mono stays for money + on-chain data (tabular). Each is
 * exposed as a CSS var and mapped to a Tailwind `font-*` utility in globals.css so `font-display` /
 * `font-sans` / `font-mono` resolve correctly.
 */
const fontSans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
import { getConfig } from "../lib/wagmi";
import { Providers } from "./providers";

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="flex min-h-dvh flex-col bg-surface font-sans text-foreground antialiased">
        <Providers initialState={initialState}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          {/* Chrome is owned per route-group (review 107): (marketing) renders the header/footer, the
              /app gate renders the sidebar + status bar, /login renders neither. Root stays chrome-free. */}
          {children}
        </Providers>
      </body>
    </html>
  );
}
