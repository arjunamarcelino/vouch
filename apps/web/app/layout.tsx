import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vouch — Confidential Outcome Assurance",
  description:
    "Provider-funded, capped performance guarantees for AI-agent work, verified confidentially after payment.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
