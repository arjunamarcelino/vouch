import type { Metadata } from "next";
import type { ReactNode } from "react";
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
import { Providers } from "./providers";
import { SiteHeader } from "../components/shell/SiteHeader";
import { SiteFooter } from "../components/shell/SiteFooter";

export const metadata: Metadata = {
  title: "Vouch — Confidential Outcome Assurance",
  description:
    "Provider-funded, capped performance guarantees for AI-agent work, verified confidentially after payment.",
  // Favicon set (files live in public/). Next renders the <link>/<meta> tags — do NOT
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
 * Root layout (Server Component) for the marketing site. Wallet-free: it owns the public chrome
 * (floating header + "built-on" footer) around every marketing route (`/`, `/demo`). The gated dApp
 * lives in a separate deployment (`apps/web`); the header's "Open App" CTA links there by absolute URL.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="flex min-h-dvh flex-col bg-surface font-sans text-foreground antialiased">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
