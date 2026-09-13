import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ShieldCheck,
  ArrowRight,
  ArrowUpRight,
  Coins,
  Network,
  Cpu,
  Check,
  EyeOff,
  Clock,
  Layers,
  Globe,
} from "lucide-react";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { LogoMarquee } from "../components/common/LogoMarquee";
import { ResolveTimeline } from "../components/home/ResolveTimeline";
import { Reveal, CountUp } from "../components/home/motion";

/**
 * Landing (WS-1) — the 20-second test, editorial/light "settlement-desk" register (de-generic pass,
 * asyah-inspired): serif display headlines + mono for money & on-chain data, a warm-paper substrate
 * with soft accent washes and a fine ledger grid, and one orchestrated CSS-only load reveal. Every
 * factual claim is preserved from the prior copy — the problem (work can break after it's paid for),
 * the escrow-vs-assurance novelty, three steps, a concrete coding-agent example, and the three sponsor
 * rails. Static server component — renders fully without a wallet. Blue stays the single reserved
 * accent (primary CTA, the Vouch side of the comparison, the confidential proof, links).
 */

// Inline stagger helper: sets the `--rise-delay` custom prop consumed by the `.rise` utility.
const delay = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

const COMPARE: { label: string; escrow: string; vouch: string; highlight?: boolean }[] = [
  { label: "When it protects", escrow: "Only until you accept", vouch: "Long after you accept", highlight: true },
  { label: "Payout trigger", escrow: "You accept delivery", vouch: "Confidential proof of a covered break" },
  { label: "Who funds it", escrow: "You escrow the fee", vouch: "The provider stakes it" },
  { label: "Recourse if it breaks", escrow: "None — funds are gone", vouch: "Capped service-credit payout" },
];

const INTEGRATIONS = [
  {
    icon: Network,
    name: "The Graph",
    body: "Indexes every verdict into a provider's on-chain track record — the risk quote reads straight from it.",
  },
  {
    icon: Coins,
    name: "Arc + Circle",
    body: "Escrow, collateral, and payouts settle in USDC on Arc, driven by the Circle Agent Stack.",
  },
  {
    icon: Cpu,
    name: "Chainlink CRE",
    body: "Runs the private test inside a TEE and signs the verdict — the only thing that can release a payout.",
  },
];

const STATS = [
  { icon: Coins, value: 100, suffix: "", label: "USDC guarantee, provider-staked" },
  { icon: Clock, value: 24, suffix: "h", label: "Confidential coverage window" },
  { icon: Layers, value: 3, suffix: "", label: "Verifiable on-chain rails" },
  { icon: Globe, value: 100, suffix: "%", label: "Settled & proven on-chain" },
];

export default function Home() {
  return (
    <div className="relative overflow-hidden">
      {/* ============================= HERO ============================= */}
      <section className="relative isolate">
        {/* Atmosphere: warm-paper wash, two soft accent glows, and a fading ledger grid. Decorative. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-paper" />
          <div className="absolute -right-32 -top-40 size-[38rem] rounded-full bg-primary/10 blur-[120px]" />
          <div className="absolute -left-40 top-24 size-[32rem] rounded-full bg-primary/[0.06] blur-[120px]" />
          <div className="absolute inset-0 text-foreground/[0.12] bg-grid [mask-image:radial-gradient(120%_80%_at_70%_0%,#000_20%,transparent_75%)]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>

        <div className="mx-auto grid max-w-[88rem] gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-12 lg:items-center lg:gap-8">
          {/* Left — the pitch */}
          <div className="lg:col-span-7">
            <div className="rise" style={delay(0)}>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-subtle-foreground shadow-sm backdrop-blur">
                Post-completion assurance
              </span>
            </div>

            <h1
              className="rise mt-6 font-display text-5xl font-bold leading-[1.02] tracking-tight text-foreground sm:text-6xl lg:text-7xl"
              style={delay(80)}
            >
              Protect the work{" "}
              <span className="relative whitespace-nowrap italic text-primary">
                after
                <svg
                  aria-hidden
                  viewBox="0 0 200 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1 left-0 h-[0.4em] w-full text-primary/40"
                >
                  <path d="M2 8 C 50 2, 150 2, 198 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>{" "}
              it&apos;s accepted and paid.
            </h1>

            <p className="rise mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground" style={delay(160)}>
              <span className="font-medium text-foreground">AI agents pass the tests, get paid, then break.</span>{" "}
              Vouch backs every delivery with a provider-funded guarantee that pays the client the instant a{" "}
              <span className="font-medium text-foreground">confidential</span> test catches a covered
              failure — settled on-chain, in USDC.
            </p>

            <div className="rise mt-9 flex flex-wrap items-center gap-3" style={delay(240)}>
              <Link
                href="/demo"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "group gap-2 shadow-lg shadow-primary/20 transition-shadow hover:shadow-primary/30",
                )}
              >
                Open judge demo
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link
                href="/dashboard"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "group gap-2")}
              >
                View dashboard
                <ArrowUpRight
                  className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </div>

          </div>

          {/* Right — the guarantee "instrument" ticket */}
          <div className="rise lg:col-span-5" style={delay(360)}>
            <GuaranteeTicket />
          </div>
        </div>
      </section>

      {/* ===================== STATS BAND ===================== */}
      <section className="mx-auto max-w-[88rem] px-4 pb-16 sm:px-6 sm:pb-24" aria-label="At a glance">
        <Reveal className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-card px-6 py-7">
              <s.icon className="size-5 text-primary" aria-hidden />
              <div className="mt-4 font-mono text-4xl font-medium tracking-tight text-foreground">
                <CountUp to={s.value} suffix={s.suffix} />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ===================== BUILT-ON TRUST STRIP ===================== */}
      <section className="border-y border-border bg-card/40 py-14 sm:py-16" aria-labelledby="rails-heading">
        <div className="mx-auto max-w-[88rem] px-4 sm:px-6">
          <div className="text-center">
            <h2 id="rails-heading" className="font-display text-3xl tracking-tight sm:text-4xl">
              Built on rails you can verify.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Escrow, confidential proof, and payout — every step runs on public infrastructure you can
              audit on-chain. Nothing is faked.
            </p>
          </div>
          <LogoMarquee className="mt-10 sm:mt-12" />
        </div>
      </section>

      <div className="mx-auto max-w-[88rem] px-4 sm:px-6">
        {/* ===================== COMPARISON SPEC SHEET ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="compare-heading">
          <SectionHeading id="compare-heading">
            Where escrow stops, <span className="italic text-primary">Vouch begins.</span>
          </SectionHeading>

          {/* Desktop: spec sheet — no icons, the Vouch column tinted as one continuous block. */}
          <div className="mt-12 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:block">
            <div className="grid grid-cols-[1.1fr_1fr_1fr]">
              {/* Column heads */}
              <div aria-hidden />
              <div className="px-6 py-5 text-base font-semibold text-foreground">Plain escrow</div>
              <div className="rounded-tr-2xl bg-primary/[0.05] px-6 py-5 text-base font-semibold text-primary">
                Vouch
              </div>

              {COMPARE.map((row, i) => {
                const last = i === COMPARE.length - 1;
                return (
                  <div key={row.label} className="contents">
                    <div className="flex items-center justify-center border-t border-border px-6 py-6 text-center text-sm font-semibold text-foreground">
                      {row.label}
                    </div>
                    <div className="flex items-center border-t border-border px-6 py-6 text-sm text-muted-foreground">
                      {row.escrow}
                    </div>
                    <div
                      className={cn(
                        "flex items-center border-t border-primary/15 bg-primary/[0.05] px-6 py-6 text-sm text-primary",
                        last && "rounded-br-2xl",
                        row.highlight && "font-medium",
                      )}
                    >
                      {row.vouch}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile: one stacked card per dimension, escrow vs the tinted Vouch value. */}
          <div className="mt-8 space-y-4 sm:hidden">
            {COMPARE.map((row) => (
              <div key={row.label} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                  {row.label}
                </div>
                <div className="grid grid-cols-2 divide-x divide-border">
                  <div className="px-4 py-3">
                    <div className="font-mono text-[0.62rem] uppercase tracking-wide text-subtle-foreground">
                      Plain escrow
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{row.escrow}</div>
                  </div>
                  <div className="bg-primary/[0.05] px-4 py-3">
                    <div className="font-mono text-[0.62rem] uppercase tracking-wide text-primary">Vouch</div>
                    <div className="mt-1 text-sm text-primary">{row.vouch}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ===================== HOW IT RESOLVES (TIMELINE) ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="how-heading">
          <SectionHeading id="how-heading">How a guarantee resolves</SectionHeading>
          <ResolveTimeline />
        </section>

        {/* ===================== CONCRETE EXAMPLE (RECEIPT) ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="example-heading">
          <SectionHeading id="example-heading">One bug, from fee to payout.</SectionHeading>
          <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
            <div className="lg:col-span-5">
              <p className="text-lg leading-relaxed text-muted-foreground">
                A client pays an AI provider <Money>20</Money> to fix an auth bug; the provider stakes{" "}
                <Money>100</Money> to back it. Public tests pass, the fee releases, and a{" "}
                <span className="font-medium text-foreground">24-hour</span> confidential window opens. If a
                private test proves a covered break, the client is paid the full <Money>100</Money> — and
                the miss lands on the provider&apos;s on-chain reputation.
              </p>
            </div>

            <div className="lg:col-span-7">
              <ReceiptFlow />
            </div>
          </div>
        </section>

        {/* ===================== THREE RAILS ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="arch-heading">
          <SectionHeading id="arch-heading">What each rail does</SectionHeading>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {INTEGRATIONS.map((it) => (
              <div
                key={it.name}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
              >
                <div className="absolute -right-16 -top-16 size-32 rounded-full bg-primary/[0.06] opacity-0 blur-2xl transition-opacity group-hover:opacity-100" />
                <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted/60 text-primary">
                  <it.icon className="size-5" aria-hidden />
                </div>
                <h3 className="mt-5 font-display text-xl tracking-tight text-foreground">{it.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ===================== CLOSING CTA BAND ===================== */}
      <section className="relative isolate overflow-hidden border-t border-border">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-paper" />
          <div className="absolute left-1/2 top-8 size-[26rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
          <div className="absolute inset-0 text-foreground/[0.1] bg-grid [mask-image:radial-gradient(90%_100%_at_50%_0%,#000,transparent_70%)]" />
        </div>
        <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 sm:py-28">
          <h2 className="font-display text-4xl leading-tight tracking-tight sm:text-6xl">
            Ship agent work clients trust —{" "}
            <span className="italic text-primary">after the invoice clears.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Watch one resolve end to end — locked collateral to a DON-signed payout, live on-chain.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/demo"
              className={cn(buttonVariants({ size: "lg" }), "group gap-2 shadow-lg shadow-primary/20")}
            >
              Open judge demo
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link href="/jobs/new" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Create a job
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

// One centered section title per section (asyah/okx register) — no eyebrow, no subtitle when the
// title already carries the meaning.
function SectionHeading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mx-auto max-w-3xl text-center font-display text-4xl leading-tight tracking-tight sm:text-5xl"
    >
      {children}
    </h2>
  );
}

// Money amount — mono + tabular so figures line up like a ledger; the "USDC" unit reads as a caption.
function Money({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap font-mono font-medium tabular-nums text-foreground">
      {children}
      <span className="ml-1 text-[0.85em] text-muted-foreground">USDC</span>
    </span>
  );
}

/** Hero instrument: a live-looking guarantee "ticket" that makes the abstract mechanism concrete. */
function GuaranteeTicket() {
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-4 -z-10 rounded-[2rem] bg-primary/10 blur-2xl" />
      <div className="sheen relative overflow-hidden rounded-2xl border border-border bg-card/80 shadow-xl backdrop-blur">
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-subtle-foreground">
            Guarantee · #4821
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 font-mono text-[0.7rem] font-medium uppercase tracking-wide text-success-text">
            <span className="size-1.5 rounded-full bg-success-fill" />
            Coverage open
          </span>
        </div>

        {/* headline figure */}
        <div className="px-6 pt-6">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle-foreground">
            Collateral locked
          </p>
          <p className="mt-1 font-mono text-4xl font-medium tabular-nums text-foreground">
            100.00 <span className="text-lg text-muted-foreground">USDC</span>
          </p>
        </div>

        {/* line items */}
        <dl className="mt-6 divide-y divide-border border-t border-border">
          <TicketRow label="Task fee">
            <span className="font-mono tabular-nums text-foreground">20.00</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[0.68rem] font-medium uppercase text-success-text">
              <Check className="size-3" aria-hidden /> Released
            </span>
          </TicketRow>
          <TicketRow label="Public tests">
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[0.68rem] font-medium uppercase text-success-text">
              <Check className="size-3" aria-hidden /> Passed
            </span>
          </TicketRow>
          <TicketRow label="Confidential test">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <EyeOff className="size-3.5" aria-hidden /> Runs in TEE
            </span>
          </TicketRow>
        </dl>

        {/* coverage window meter */}
        <div className="px-6 py-5">
          <div className="flex items-center justify-between font-mono text-xs text-subtle-foreground">
            <span className="uppercase tracking-[0.14em]">Coverage window</span>
            <span className="tabular-nums text-foreground">14h 22m left</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[60%] rounded-full bg-gradient-to-r from-primary/70 to-primary" />
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-6 py-3.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-subtle-foreground">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden />
          Verdict → on-chain reputation
        </div>
      </div>
    </div>
  );
}

function TicketRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

/** Worked-example receipt: a vertical settlement flow with mono figures and status. */
function ReceiptFlow() {
  const rows = [
    { t: "Client funds task fee", v: "+20.00", tone: "neutral" as const },
    { t: "Provider locks guarantee", v: "+100.00", tone: "neutral" as const },
    { t: "Public tests pass → fee released", v: "−20.00", tone: "good" as const },
    { t: "24h confidential coverage opens", v: "TEE", tone: "muted" as const },
    { t: "Regression proves covered failure", v: "PROOF", tone: "muted" as const },
    { t: "Guarantee paid to client", v: "→100.00", tone: "pay" as const },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-subtle-foreground">
          Settlement ledger
        </span>
        <span className="font-mono text-xs text-subtle-foreground">Arc · USDC</span>
      </div>
      <ol className="divide-y divide-border">
        {rows.map((r, i) => (
          <li key={r.t} className="flex items-center gap-4 px-5 py-3.5">
            <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 text-sm text-foreground">{r.t}</span>
            <span
              className={cn(
                "font-mono text-sm tabular-nums",
                r.tone === "good" && "text-success-text",
                r.tone === "pay" && "font-semibold text-primary",
                r.tone === "neutral" && "text-foreground",
                r.tone === "muted" && "text-[0.7rem] uppercase tracking-wide text-subtle-foreground",
              )}
            >
              {r.v}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between border-t border-border bg-primary/[0.04] px-5 py-3.5">
        <span className="font-mono text-xs uppercase tracking-[0.12em] text-primary">Client made whole</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-primary">100.00 USDC</span>
      </div>
    </div>
  );
}
