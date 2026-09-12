import Link from "next/link";
import { TechStrip } from "../components/common/TechStrip";
import {
  ShieldCheck,
  ArrowRight,
  FileCheck2,
  Lock,
  Coins,
  Network,
  Cpu,
  Check,
  X,
} from "lucide-react";
import { buttonVariants } from "@vouch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vouch/ui/components/card";
import { Badge } from "@vouch/ui/components/badge";
import { cn } from "@vouch/ui/lib/utils";

/**
 * Landing (WS-1) — the 20-second test. Headline states the problem (work can break after it's paid
 * for); one escrow-vs-assurance comparison shows the novelty; three steps + a concrete coding-agent
 * example make it concrete; the integration summary names the three sponsor rails; one primary CTA
 * opens the judge demo. Static server component — renders fully without a wallet. Blue is reserved for
 * the single primary CTA, the one highlighted comparison cell, and links.
 */

const STEPS = [
  {
    icon: Lock,
    title: "Fund & lock",
    body: "The client funds the task fee; the provider locks a capped, self-funded guarantee as collateral.",
  },
  {
    icon: FileCheck2,
    title: "Accept & open coverage",
    body: "Public tests pass, the task fee is released, and a post-acceptance coverage window opens.",
  },
  {
    icon: ShieldCheck,
    title: "Prove & pay out",
    body: "If a confidential regression test proves a covered failure in the window, the client is paid the guarantee.",
  },
];

const COMPARE: { label: string; escrow: string; vouch: string; highlight?: boolean }[] = [
  { label: "When it protects", escrow: "Only until acceptance", vouch: "After acceptance", highlight: true },
  { label: "Payout trigger", escrow: "Acceptance of delivery", vouch: "Confidential proof of a covered regression" },
  { label: "Who funds it", escrow: "Client escrows the fee", vouch: "Provider self-funds a capped guarantee" },
  { label: "Recourse after payment", escrow: "None — funds released", vouch: "Capped service-credit payout" },
];

const INTEGRATIONS = [
  { icon: Network, name: "The Graph", body: "Provider reputation indexed from on-chain events — load-bearing input to the risk quote." },
  { icon: Coins, name: "Arc + Circle", body: "USDC escrow, collateral, and capped payouts settle on Arc; the agent uses the Circle Agent Stack." },
  { icon: Cpu, name: "Chainlink CRE", body: "The private regression test runs inside a TEE; the DON-signed verdict is the sole payout gate." },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="py-16 sm:py-24">
        <Badge variant="default" className="mb-5">
          Post-completion assurance
        </Badge>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Protect the work <span className="text-primary">after</span> it&apos;s accepted and paid.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Acceptance tests are a point-in-time signal. AI-agent code can pass the public suite, get
          paid, then break. Vouch adds a provider-funded, capped guarantee that a{" "}
          <span className="text-foreground">confidential</span> test can trigger during a coverage
          window — settled on-chain, with the verdict written to the provider&apos;s reputation.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/demo" className={cn(buttonVariants({ size: "lg" }), "gap-2")}>
            Open judge demo <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "lg" })}>
            View dashboard
          </Link>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Not a marketplace. Not insurance. Not plain escrow.
        </p>
      </section>

      {/* Built on — the stack we actually use */}
      <section className="border-y border-border py-8" aria-label="Built on">
        <TechStrip />
      </section>

      {/* Escrow vs post-completion assurance */}
      <section className="py-6" aria-labelledby="compare-heading">
        <h2 id="compare-heading" className="text-sm font-medium uppercase tracking-wide text-subtle-foreground">
          Escrow vs. post-completion assurance
        </h2>
        <Card className="mt-3 overflow-hidden">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-[1.2fr_1fr_1fr] sm:divide-y-0">
            <div className="hidden bg-muted/40 px-5 py-3 text-xs font-medium uppercase tracking-wide text-subtle-foreground sm:block" />
            <div className="hidden bg-muted/40 px-5 py-3 text-xs font-medium uppercase tracking-wide text-subtle-foreground sm:block">
              Plain escrow
            </div>
            <div className="hidden bg-muted/40 px-5 py-3 text-xs font-medium uppercase tracking-wide text-subtle-foreground sm:block">
              Vouch
            </div>
            {COMPARE.map((row) => (
              <div key={row.label} className="contents">
                <div className="border-t border-border px-5 py-4 text-sm font-medium">{row.label}</div>
                <div className="flex items-center gap-2 border-t border-border px-5 py-4 text-sm text-muted-foreground">
                  <X className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {row.escrow}
                </div>
                <div
                  className={cn(
                    "flex items-center gap-2 border-t border-border px-5 py-4 text-sm",
                    row.highlight ? "bg-primary/5 font-medium text-primary" : "text-foreground",
                  )}
                >
                  <Check
                    className={cn("size-4 shrink-0", row.highlight ? "text-primary" : "text-success")}
                    aria-hidden
                  />
                  {row.vouch}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Three steps */}
      <section className="py-12" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-sm font-medium uppercase tracking-wide text-subtle-foreground">
          How a guarantee resolves
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <Card key={step.title}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                  {i + 1}
                </span>
                <step.icon className="size-5 text-primary" aria-hidden />
                <CardTitle className="text-base">{step.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{step.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Concrete coding-agent example */}
      <section className="py-6" aria-labelledby="example-heading">
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardHeader>
            <CardTitle id="example-heading" className="text-base">
              A concrete coding-agent example
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              A client pays an AI coding provider{" "}
              <span className="font-medium tabular-nums text-foreground">20 USDC</span> to fix an
              authentication bug. The provider locks{" "}
              <span className="font-medium tabular-nums text-foreground">100 USDC</span> as a
              guarantee. Public tests pass, so the 20 USDC fee is released.
            </p>
            <p>
              For the next <span className="font-medium text-foreground">24 hours</span>, a private
              regression test runs confidentially. If it proves the fix broke something covered, the
              client receives the <span className="font-medium tabular-nums text-foreground">100 USDC</span>{" "}
              guarantee — and the outcome is written to the provider&apos;s on-chain reputation.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Architecture / integration summary */}
      <section className="py-12" aria-labelledby="arch-heading">
        <h2 id="arch-heading" className="text-sm font-medium uppercase tracking-wide text-subtle-foreground">
          Built on three rails
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {INTEGRATIONS.map((it) => (
            <Card key={it.name}>
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <it.icon className="size-5 text-primary" aria-hidden />
                <CardTitle className="text-base">{it.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{it.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer / honesty note */}
      <footer className="border-t border-border py-8 text-xs text-subtle-foreground">
        Sponsor integrations surface an explicit state. When a testnet credential isn&apos;t
        configured, the UI shows a clearly-labeled local simulation and never fabricates a
        transaction or explorer link.
      </footer>
    </div>
  );
}
