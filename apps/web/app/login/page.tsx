"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
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
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (me.data) router.replace(next);
  }, [me.data, next, router]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <TestnetBadge />
      <h1 className="mt-4 font-display text-3xl tracking-tight sm:text-4xl">Sign in to Vouch</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Connect your wallet and sign the one-time message to access your dashboard, jobs, and coverage.
        Nothing is submitted on-chain here — signing only proves you own the address.
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
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <LoginInner />
    </Suspense>
  );
}
