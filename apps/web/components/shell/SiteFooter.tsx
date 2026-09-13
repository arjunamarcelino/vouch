import { TechStrip } from "../common/TechStrip";
import { TestnetBadge } from "../common/TestnetBadge";

/**
 * App shell footer: the "Built on" stack strip + a light legal line. Rendered only by the `(marketing)`
 * route-group layout (review 107), so it no longer self-gates on `pathname` — the gated app and login
 * screen simply don't mount it.
 */
export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-border bg-paper">
      <div className="mx-auto flex max-w-[88rem] flex-col gap-8 px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-lg">
            <TestnetBadge />
            <p className="mt-3 font-display text-2xl leading-snug tracking-tight text-foreground sm:text-3xl">
              Confidential Outcome Assurance for Agentic Work.
            </p>
          </div>
          <TechStrip size="sm" />
        </div>

        <div className="h-px w-full bg-border" />

        <div className="flex flex-col gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Vouch</span>
          <span>Sponsor logos are property of their respective owners.</span>
        </div>
      </div>
    </footer>
  );
}
