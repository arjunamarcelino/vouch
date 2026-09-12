"use client";

import { Loader2, CheckCircle2, AlertTriangle, XCircle, ShieldAlert, ExternalLink } from "lucide-react";
import { cn } from "@vouch/ui/lib/utils";
import { buttonVariants } from "@vouch/ui/components/button";
import type { TxFlow } from "../../lib/tx/engine";
import { explorerTxLink } from "../../lib/format";

/**
 * Inline transaction-status region for a `TxFlow` (plan §Wallet/TX UX). Announces via `aria-live` (an
 * inline region is more robust than a focus-trapped modal for status). Renders approval and transaction
 * stages SEPARATELY, never shows success before a confirmed receipt, surfaces actionable errors, and
 * shows an explorer link ONLY for a confirmed on-chain hash (provenance-gated). `onReset` clears it.
 */
type Tone = "pending" | "success" | "error" | "warning";

function view(flow: TxFlow): { tone: Tone; title: string; detail?: string; hash?: string; confirmed: boolean } | null {
  switch (flow.stage) {
    case "idle":
      return null;
    case "preparing":
      return { tone: "pending", title: "Preparing transaction…", confirmed: false };
    case "switchingChain":
      return { tone: "pending", title: "Switch your wallet to Arc testnet…", confirmed: false };
    case "approving":
      return { tone: "pending", title: "Step 1 of 2 — approve USDC", detail: "Confirm the USDC approval in your wallet.", confirmed: false };
    case "awaitingSignature":
      return { tone: "pending", title: "Confirm in your wallet…", detail: "Review the amount and recipient in your wallet before signing.", confirmed: false };
    case "submitted":
      return { tone: "pending", title: "Submitted — waiting for confirmation…", hash: flow.hash, confirmed: false };
    case "tracking":
      return { tone: "pending", title: "Confirmed — verifying against the prepared intent…", hash: flow.hash, confirmed: true };
    case "confirming":
      return { tone: "pending", title: "Finalizing…", hash: flow.hash, confirmed: true };
    case "done":
      return {
        tone: "success",
        title: flow.simulated ? "Done (local simulation)" : "Confirmed on-chain",
        detail: flow.simulated ? "Simulated — no real transaction was sent." : undefined,
        hash: flow.hash,
        confirmed: !flow.simulated && !!flow.hash,
      };
    case "reverted":
      return { tone: "error", title: "Transaction reverted", detail: flow.reason, hash: flow.hash, confirmed: true };
    case "trackMismatch":
      return {
        tone: "error",
        title: "Mismatch — do not trust this result",
        detail: "The mined transaction did not match what was prepared. It was not bound; treat with caution.",
        hash: flow.hash,
        confirmed: true,
      };
    case "rejected":
      return { tone: "warning", title: "Signature declined", detail: "You can retry when ready.", confirmed: false };
    case "error":
      return { tone: "error", title: "Could not complete", detail: `${flow.message}`, confirmed: false };
  }
}

const TONE_CLS: Record<Tone, string> = {
  pending: "border-border bg-muted/40 text-foreground",
  success: "border-success/30 bg-success/5 text-success",
  error: "border-destructive/30 bg-destructive/5 text-destructive",
  warning: "border-warning/30 bg-warning/5 text-warning",
};

export function TxStatus({ flow, onReset }: { flow: TxFlow; onReset?: () => void }) {
  const v = view(flow);
  if (!v) return null;
  const Icon =
    v.tone === "success" ? CheckCircle2 : v.tone === "error" ? (flow.stage === "trackMismatch" ? ShieldAlert : XCircle) : v.tone === "warning" ? AlertTriangle : Loader2;
  const link = explorerTxLink(v.hash, v.confirmed);
  const terminal = ["done", "reverted", "trackMismatch", "rejected", "error"].includes(flow.stage);

  return (
    <div role="status" aria-live="polite" className={cn("rounded-lg border px-4 py-3 text-sm", TONE_CLS[v.tone])}>
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", v.tone === "pending" && "animate-spin")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{v.title}</p>
          {v.detail ? <p className="mt-0.5 text-muted-foreground">{v.detail}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                View on Arcscan <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            {terminal && onReset ? (
              <button onClick={onReset} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2")}>
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
