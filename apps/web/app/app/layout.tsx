"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuthMe } from "../../lib/api/hooks";

/**
 * Auth gate for the `/app/*` surface. Everything under `/app` requires a SIWE session — the httpOnly
 * cookie surfaced through `useAuthMe()` (401 → null). While the session is being checked we hold on a
 * spinner rather than flashing the page; once resolved, an unauthenticated visitor is redirected to
 * `/login?next=<path>` so they land back here after signing in. The session is the ONLY source of truth
 * (never optimistic wallet state), matching the server-side AuthGuard the API enforces.
 */
export default function AppGateLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useAuthMe();

  useEffect(() => {
    if (!me.isLoading && !me.data) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [me.isLoading, me.data, pathname, router]);

  if (me.isLoading || !me.data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" aria-live="polite">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {me.isLoading ? "Checking your session…" : "Redirecting to sign in…"}
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
