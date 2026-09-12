import { TechStrip } from "../common/TechStrip";

/**
 * App shell footer: the "Built on" stack strip + a light legal line. Renders on every page via the
 * root layout. Third-party logos remain unmodified and link to their owners.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <TechStrip />
        <p className="text-xs text-subtle-foreground">
          Sponsor integrations surface an explicit state. When a testnet credential isn&apos;t
          configured, the UI shows a clearly-labeled local simulation and never fabricates a
          transaction or explorer link.
        </p>
        <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Vouch — confidential outcome assurance for agentic work.</span>
          <span>Sponsor logos are the property of their respective owners.</span>
        </div>
      </div>
    </footer>
  );
}
