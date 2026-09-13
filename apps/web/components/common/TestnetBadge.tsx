import { cn } from "@vouch/ui/lib/utils";

/**
 * "Testnet" status pill — a subtle mono chip with an amber dot, signalling the app runs against testnet
 * rails (not production). Shown next to the wordmark and in the footer.
 */
export function TestnetBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[0.6rem] font-medium uppercase tracking-[0.12em] text-subtle-foreground",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-warning-fill" aria-hidden />
      Testnet
    </span>
  );
}
