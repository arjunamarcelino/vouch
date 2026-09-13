"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@vouch/ui/components/card";
import { useAuthMe } from "../../lib/api/hooks";
import { WalletConnectButton } from "../../components/wallet/ConnectButton";
import { TestnetBadge } from "../../components/common/TestnetBadge";

/**
 * Sign-in page for the gated `/app/*` surface. The wallet + SIWE flow runs through RainbowKit
 * (WalletConnectButton) exactly as elsewhere; this page simply presents it and, once a session is
 * established (`useAuthMe().data`), forwards to the `?next=` path the gate captured (defaulting to the
 * dashboard). A visitor who is already signed in is bounced straight through — no dead-end.
 */
const DEFAULT_NEXT = "/app/dashboard";

/** Only allow same-app relative redirects — never an attacker-supplied absolute/protocol-relative URL. */
function safeNext(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_NEXT;
  return raw;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const me = useAuthMe();
  const { address, isConnected } = useAccount();
  const next = safeNext(params.get("next"));

  // Forward only when the wallet is connected AND a SIWE session exists FOR THAT SAME ADDRESS — matches
  // the /app gate (review 105). Redirecting on the session alone (stale cookie, or a cookie bound to a
  // different address) would either ping-pong with the gate or forward into an identity-mismatch state.
  const sessionMatchesWallet = isConnected && !!me.data && me.data.address.toLowerCase() === address?.toLowerCase();
  useEffect(() => {
    if (sessionMatchesWallet) router.replace(next);
  }, [sessionMatchesWallet, next, router]);

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-2">
      {/* Floating back link — top-left of the page, over the asset panel on desktop / the form on mobile. */}
      <Link
        href="/"
        className="absolute left-6 top-10 z-10 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:left-10 sm:top-12 lg:left-12"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to Homepage
      </Link>

      {/* Left — brand asset panel (hero register). Hidden below lg; the sign-in stands alone on mobile. */}
      <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center lg:p-12 xl:p-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-paper" />
          <div className="absolute -left-24 top-1/4 size-[34rem] rounded-full bg-primary/10 blur-[130px]" />
          <div className="absolute inset-0 text-foreground/[0.1] bg-grid [mask-image:radial-gradient(120%_90%_at_30%_20%,#000_20%,transparent_75%)]" />
        </div>
        <div className="relative mx-auto w-full max-w-lg">
          <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-primary/15 blur-3xl" />
          <div className="animate-float relative aspect-[3/2] overflow-hidden rounded-3xl">
            <Image
              src="/bg-hero.webp"
              alt="Vouch — a glass mark encircling proof, document, and shield tiles"
              fill
              sizes="50vw"
              priority
              className="object-cover"
            />
          </div>
        </div>
      </div>

      {/* Right — sign in, vertically centered in the column. */}
      <div className="flex items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full max-w-md text-center">
            <TestnetBadge />
            <h1 className="mt-4 font-display text-3xl tracking-tight sm:text-4xl">Sign in to Vouch</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect your wallet and sign the one-time message to access your dashboard, jobs, and
              coverage. Nothing is submitted on-chain here — signing only proves you own the address.
            </p>

            <Card className="mt-8 w-full">
              <CardContent className="flex flex-col items-center gap-4 p-6">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                  <ShieldCheck className="size-4" aria-hidden /> Sign-In with Ethereum (SIWE)
                </span>
                <WalletConnectButton />
                {me.isLoading ? (
                  <p className="text-xs text-muted-foreground">Checking your session…</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Just exploring?{" "}
                    <Link href="/demo" className="text-primary hover:underline">
                      Open the judge demo
                    </Link>{" "}
                    — no wallet required.
                  </p>
                )}
              </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <LoginInner />
    </Suspense>
  );
}
