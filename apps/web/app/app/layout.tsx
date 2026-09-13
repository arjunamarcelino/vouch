"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { Loader2 } from "lucide-react";
import { useAuthMe } from "../../lib/api/hooks";
import { AppShell } from "../../components/shell/AppShell";

/**
 * Auth gate for the `/app/*` surface. Access requires BOTH a live wallet connection (wagmi) AND a SIWE
 * session (the httpOnly cookie surfaced through `useAuthMe()`, 401 → null). Either one missing → redirect
 * to `/login?next=<path>` so the visitor connects + signs and lands back here. wagmi restores the wallet
 * from the request cookie on first paint, so its `connecting`/`reconnecting` window counts as "resolving"
 * — a connected user with a live session is never flashed to /login before reconnect settles. Disconnect
 * is handled upstream by the providers' AuthGate (account change → server logout + cache clear), which
 * drops `me.data` to null and routes back through here — i.e. disconnect == logout.
 */
export default function AppGateLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useAuthMe();
  const { address, isConnected, status } = useAccount();

  const resolving = me.isLoading || status === "connecting" || status === "reconnecting";
  // Require the SIWE session to belong to the CURRENTLY connected wallet (review 105) — a still-valid
  // cookie bound to a different address (account switched while away, or a lost logout) must not admit.
  const authed = isConnected && !!me.data && me.data.address.toLowerCase() === address?.toLowerCase();

  useEffect(() => {
    if (!resolving && !authed) {
      // Carry the full path INCL. query string so deep links (e.g. ?tab=evidence) survive sign-in
      // (review 106/114). `pathname` for the SSR-safe part; `search` read client-side in this effect.
      const here = pathname + (typeof window !== "undefined" ? window.location.search : "");
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [resolving, authed, pathname, router]);

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" aria-live="polite">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {resolving ? "Checking your wallet & session…" : "Redirecting to sign in…"}
        </span>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
