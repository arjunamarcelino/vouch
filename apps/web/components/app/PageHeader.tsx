import type { ReactNode } from "react";

/**
 * Shared header for the gated app pages (Overview / Jobs / Create). One rhythm everywhere: a display
 * title, an optional muted subtitle, and an optional right-aligned actions slot. Back links (create flow)
 * are rendered by the page itself, above this, so route-typed hrefs stay literal.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
