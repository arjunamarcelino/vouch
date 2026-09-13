"use client";

import { ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@vouch/ui/components/sheet";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { USDC_ADDRESS, arcTestnet } from "@vouch/shared/chains";
import { useIntegrationsHealth } from "../../lib/api/hooks";
import { resolveMode } from "../../lib/mode";
import { explorerAddressLink } from "../../lib/format";
import { ModePill } from "../common/indicators";

/**
 * Prize Evidence drawer (demo-mode only). Surfaces, per sponsor track, whether the integration is LIVE
 * (configured + reachable via /health/integrations) or an explicit "Not configured — local simulation".
 * It renders REAL links only (the provenance-gated explorer helper); it never fabricates a tx hash or a
 * live endpoint. Chainlink CRE has no live API probe — its evidence is the sanitized `cre workflow
 * simulate` output committed to the repo, so that row is evidence-based, not a live/sim toggle. Styling
 * mirrors the redesigned demo page: no per-row icons, a mono track eyebrow, and a font-display title.
 */

function EvidenceRow({
  eyebrow,
  title,
  live,
  liveLabel,
  children,
}: {
  eyebrow: string;
  title: string;
  live: boolean;
  liveLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-subtle-foreground">
            {eyebrow}
          </span>
          <h3 className="font-display text-sm tracking-tight text-foreground sm:text-base">{title}</h3>
        </div>
        <ModePill live={live} liveLabel={liveLabel} simLabel={liveLabel ?? "Not configured · local simulation"} />
      </div>
      <div className="mt-2.5 space-y-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function extLink(href: string, text: string) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
    >
      {text} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function PrizeEvidenceDrawer() {
  const health = useIntegrationsHealth();
  const mode = resolveMode(health.data);
  const graphProbe = mode.probe("graph");
  const arcProbe = mode.probe("arc");
  const lastBlock = graphProbe?.detail?.["latestIndexedBlock"];
  const arcBlock = arcProbe?.detail?.["latestBlock"];
  const usdcLink = explorerAddressLink(USDC_ADDRESS);

  return (
    <Sheet>
      <SheetTrigger className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
        <ExternalLink className="size-4" aria-hidden /> Prize evidence
      </SheetTrigger>
      <SheetContent aria-describedby="evidence-desc">
        <SheetHeader>
          <SheetTitle>Prize evidence</SheetTitle>
          <SheetDescription id="evidence-desc">
            Provenance for each sponsor rail. A row reads LIVE only when its integration is reachable
            through the API readiness probe; otherwise the demo runs a clearly-labeled local simulation
            and shows no fabricated links or transaction hashes.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3">
          <EvidenceRow eyebrow="The Graph" title="Indexed reputation" live={mode.graph}>
            <p>Provider reputation indexed from on-chain events — the load-bearing input to the risk quote.</p>
            {mode.graph && lastBlock ? (
              <p>
                Last indexed block: <span className="font-medium tabular-nums text-foreground">{String(lastBlock)}</span>
                {graphProbe?.detail?.["dataConfidence"] ? ` · ${String(graphProbe.detail["dataConfidence"])}` : ""}
              </p>
            ) : (
              <p>Subgraph endpoint not configured — showing indexed values from the seeded simulation.</p>
            )}
          </EvidenceRow>

          <EvidenceRow eyebrow="Arc + Circle" title="USDC settlement" live={mode.arc}>
            <p>
              USDC escrow, collateral, and capped payouts settle on {arcTestnet.name} (chainId{" "}
              <span className="tabular-nums">{arcTestnet.id}</span>).
            </p>
            {mode.arc && arcBlock ? (
              <p>
                RPC head: <span className="font-medium tabular-nums text-foreground">{String(arcBlock)}</span>
              </p>
            ) : null}
            <p className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
              {extLink(arcTestnet.blockExplorers.default.url, "Arcscan")}
              {usdcLink ? extLink(usdcLink, "USDC token") : null}
            </p>
          </EvidenceRow>

          <EvidenceRow eyebrow="Circle Agent Stack" title="Autonomous quoting" live={mode.agent}>
            <p>
              The autonomous agent quotes guarantee size from live reputation and posts a refundable
              bond from a policy-capped Circle wallet — it never settles the guarantee.
            </p>
            <p>
              {mode.agent
                ? "Agent reachable — action log available in live mode."
                : "Agent not configured — bond/quote actions are simulated."}
            </p>
          </EvidenceRow>

          <EvidenceRow
            eyebrow="Chainlink CRE"
            title="Confidential verdict"
            live={false}
            liveLabel="Evidence: CLI simulation"
          >
            <p>
              The private regression test runs inside a TEE; the DON-signed verdict{" "}
              <span className="text-foreground">{`{jobId, covered, amount}`}</span> is the sole payout
              gate. The secret never appears in logs.
            </p>
            <p>
              Evidence is the sanitized <span className="font-mono text-xs">cre workflow simulate</span>{" "}
              output committed under <span className="font-mono text-xs">docs/evidence/</span>.
            </p>
          </EvidenceRow>
        </div>
      </SheetContent>
    </Sheet>
  );
}
