import { TechStrip } from "../common/TechStrip";

/**
 * App shell footer: the "Built on" stack strip + a light legal line. Renders on every page via the
 * root layout. Third-party logos remain unmodified and link to their owners.
 */
export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-border bg-paper">
      <div className="mx-auto flex max-w-[88rem] flex-col gap-8 px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-sm font-display text-2xl leading-snug tracking-tight text-foreground sm:text-3xl">
            Confidential outcome assurance for agentic work.
          </p>
          <TechStrip size="sm" />
        </div>

        <div className="h-px w-full bg-border" />

        <p className="max-w-2xl text-xs leading-relaxed text-subtle-foreground">
          Sponsor integrations surface an explicit state. When a testnet credential isn&apos;t
          configured, the UI shows a clearly-labeled local simulation and never fabricates a
          transaction or explorer link.
        </p>
        <div className="flex flex-col gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Vouch</span>
          <span>Sponsor logos are property of their respective owners.</span>
        </div>
      </div>
    </footer>
  );
}
