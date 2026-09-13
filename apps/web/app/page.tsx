import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import {
  ShieldCheck,
  ArrowRight,
  Check,
  EyeOff,
} from "lucide-react";
import { buttonVariants } from "@vouch/ui/components/button";
import { cn } from "@vouch/ui/lib/utils";
import { LogoMarquee } from "../components/common/LogoMarquee";
import { ResolveTimeline } from "../components/home/ResolveTimeline";
import { ReceiptFlow } from "../components/home/ReceiptFlow";
import { Reveal, CountUp } from "../components/home/motion";
import { SECTION } from "../lib/home-sections";

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
  { label: "When It Protects", escrow: "Only until you accept", vouch: "Long after you accept", highlight: true },
  { label: "Payout Trigger", escrow: "You accept delivery", vouch: "Confidential proof of a covered break" },
  { label: "Who Funds It", escrow: "You escrow the fee", vouch: "The provider stakes it" },
  { label: "Recourse If It Breaks", escrow: "None — funds are gone", vouch: "Capped service-credit payout" },
];

const INTEGRATIONS = [
  {
    name: "The Graph",
    logos: ["/logos/the-graph/the-graph-ink.svg"],
    body: "Indexes every verdict into a provider's on-chain track record — the risk quote reads straight from it.",
  },
  {
    name: "Arc + Circle",
    logos: ["/logos/arc/Arc_Logo_Navy.svg", "/logos/circle/circle-logo-licorice.svg"],
    body: "Escrow, collateral, and payouts settle in USDC on Arc, driven by the Circle Agent Stack.",
  },
  {
    name: "Chainlink CRE",
    logos: ["/logos/chainlink/Chainlink-Logo-Blue.svg"],
    body: "Runs the private test inside a TEE and signs the verdict — the only thing that can release a payout.",
  },
];

const ANATOMY = [
  { title: "Collateral Locked", body: "The provider's capped stake, escrowed on Arc before the work begins." },
  { title: "Fee Released", body: "Public tests pass and the task fee pays out — acceptance, on-chain." },
  { title: "Confidential Test", body: "A private regression runs inside a TEE; the secret never leaves the enclave." },
  { title: "Verdict → Reputation", body: "The signed outcome settles the payout and writes to the provider's history." },
];

// Three pillars, each showing one icon from the /icon-asset.webp sprite (shield / document / cube),
// selected via background-position (0% / 50% / 100%).
const PILLARS = [
  {
    pos: "0%",
    title: "Backed by Collateral",
    body: "The provider stakes a capped guarantee up front — real money behind every delivery, not a promise.",
  },
  {
    pos: "50%",
    title: "Proven Confidentially",
    body: "A private regression test decides the outcome inside a TEE; the criteria never leak.",
  },
  {
    pos: "100%",
    title: "Settled On-Chain",
    body: "Escrow, collateral, and payout all settle on-chain — auditable end to end.",
  },
];

const STATS = [
  { img: "/icon-stats-1.webp", value: 100, suffix: "", label: "USDC guarantee, provider-staked" },
  { img: "/icon-stats-2.webp", value: 24, suffix: "h", label: "Confidential coverage window" },
  { img: "/icon-stats-3.webp", value: 3, suffix: "", label: "Verifiable on-chain rails" },
  { img: "/icon-stats-4.webp", value: 100, suffix: "%", label: "Settled & proven on-chain" },
];

export default function Home() {
  return (
    <div id={SECTION.top} className="relative overflow-hidden">
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

        <div className="mx-auto grid max-w-[88rem] gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pb-28 sm:pt-20 lg:grid-cols-12 lg:items-center lg:gap-8">
          {/* Left — the pitch */}
          <div className="lg:col-span-7">
            <div className="rise" style={delay(0)}>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-subtle-foreground shadow-sm backdrop-blur">
                Post-completion assurance
              </span>
            </div>

            <h1
              className="rise mt-6 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl"
              style={delay(80)}
            >
              Protect the Work{" "}
              <span className="relative mr-3 whitespace-nowrap italic text-primary">
                After
                <svg
                  aria-hidden
                  viewBox="0 0 200 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1 left-0 h-[0.4em] w-full text-primary/40"
                >
                  <path d="M2 8 C 50 2, 150 2, 198 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>{" "}
              It&apos;s Accepted and Paid.
            </h1>

            <p className="rise mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground" style={delay(160)}>
              <span className="font-medium text-foreground">AI agents pass the tests, get paid, then break.</span>{" "}
              Vouch backs every delivery with a provider-funded guarantee that pays the client the instant a{" "}
              <span className="font-medium text-foreground">confidential</span> test catches a covered
              failure — settled on-chain, in USDC.
            </p>

            <div className="rise mt-9 flex flex-wrap items-center gap-3" style={delay(240)}>
              <Link href="/demo" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "gap-2")}>
                Demo
              </Link>
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "group gap-2",
                )}
              >
                Open App
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>

          </div>

          {/* Right — the Vouch brand render, floating in a dark showcase panel */}
          <div className="rise lg:col-span-5" style={delay(360)}>
            <div className="relative">
              <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-primary/15 blur-3xl" />
              <div className="animate-float relative aspect-[3/2] overflow-hidden rounded-3xl">
                <Image
                  src="/bg-hero.webp"
                  alt="Vouch — a glass mark encircling proof, document, and shield tiles"
                  fill
                  sizes="(min-width: 1024px) 40vw, 100vw"
                  priority
                  className="object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== STATS BAND ===================== */}
      <section className="mx-auto max-w-[88rem] px-4 pb-16 sm:px-6 sm:pb-24" aria-label="At a glance">
        <Reveal className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm lg:grid-cols-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="group flex items-center gap-4 bg-card px-5 py-4 transition-colors duration-300 hover:bg-muted/40 sm:px-6"
            >
              <Image
                src={s.img}
                alt=""
                aria-hidden
                width={96}
                height={96}
                className="size-16 shrink-0 object-contain transition-transform duration-500 ease-out group-hover:-translate-y-1.5 group-hover:rotate-3 group-hover:scale-110 motion-reduce:transition-none sm:size-20 lg:size-24"
              />
              <div className="min-w-0">
                <div className="font-mono text-3xl font-medium tracking-tight text-foreground">
                  <CountUp to={s.value} suffix={s.suffix} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ===================== BUILT-ON TRUST STRIP ===================== */}
      <section className="border-y border-border bg-card/40 py-14 sm:py-16" aria-labelledby="rails-heading">
        <div className="mx-auto max-w-[88rem] px-4 sm:px-6">
          <div className="text-center">
            <h2 id="rails-heading" className="font-display text-3xl tracking-tight sm:text-4xl">
              Built on Rails You Can Verify.
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
        {/* ===================== THREE PILLARS ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="pillars-heading">
          <SectionHeading id="pillars-heading">
            Backed. Proven. <span className="italic text-primary">Settled.</span>
          </SectionHeading>
          <div className="mt-14 grid gap-5 sm:grid-cols-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={i * 110}>
                <div className="group h-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
                  <span
                    role="img"
                    aria-label={p.title}
                    className="mx-auto block aspect-[591/887] h-28 bg-no-repeat transition-transform duration-500 group-hover:-translate-y-1.5 group-hover:scale-105 motion-reduce:transition-none"
                    style={{
                      backgroundImage: "url(/icon-asset.webp)",
                      backgroundSize: "300% 100%",
                      backgroundPosition: `${p.pos} center`,
                    }}
                  />
                  <h3 className="mt-6 font-display text-2xl tracking-tight text-foreground">{p.title}</h3>
                  <p className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ===================== ANATOMY (TICKET SHOWCASE) ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="anatomy-heading">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <Reveal>
              <span className="font-mono text-xs uppercase tracking-[0.16em] text-subtle-foreground">
                The instrument
              </span>
              <h2 id="anatomy-heading" className="mt-4 font-display text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl">
                Anatomy of a Guarantee
              </h2>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
                Every job carries a live guarantee ticket — one object that shows exactly what&apos;s
                staked, what&apos;s cleared, and what&apos;s still in force.
              </p>
              <ul className="mt-8 space-y-4">
                {ANATOMY.map((a) => (
                  <li key={a.title} className="flex gap-3.5">
                    <span aria-hidden className="mt-[0.45rem] size-2 shrink-0 rounded-full bg-primary/80 ring-4 ring-primary/10" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{a.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={120}>
              <GuaranteeTicket />
            </Reveal>
          </div>
        </section>

        {/* ===================== COMPARISON SPEC SHEET ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="compare-heading">
          <SectionHeading id={SECTION.compare}>
            Where Escrow Stops,
            <br />
            <span className="italic text-primary">Vouch Begins.</span>
          </SectionHeading>

          {/* Desktop: spec sheet — no icons, the Vouch column tinted as one continuous block. Each data
              row reveals on scroll (staggered) via its own Reveal, which is the row's grid container. */}
          <div className="mt-12 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:block">
            {/* Column heads */}
            <div className="grid grid-cols-[1.1fr_1fr_1fr]">
              <div aria-hidden />
              <div className="px-6 py-5 text-base font-semibold text-foreground">Plain Escrow</div>
              <div className="rounded-tr-2xl bg-primary/[0.05] px-6 py-5 text-base font-semibold text-primary">
                Vouch
              </div>
            </div>

            {COMPARE.map((row, i) => {
              const last = i === COMPARE.length - 1;
              return (
                <Reveal key={row.label} delay={i * 90} className="group grid grid-cols-[1.1fr_1fr_1fr]">
                  <div className="flex items-center justify-center border-t border-border px-6 py-6 text-center text-sm font-semibold text-foreground transition-colors duration-200 group-hover:bg-muted/50">
                    {row.label}
                  </div>
                  <div className="flex items-center border-t border-border px-6 py-6 text-sm text-muted-foreground transition-colors duration-200 group-hover:bg-muted/50">
                    {row.escrow}
                  </div>
                  <div
                    className={cn(
                      "flex items-center border-t border-primary/15 bg-primary/[0.05] px-6 py-6 text-sm text-primary transition-colors duration-200 group-hover:bg-primary/[0.11]",
                      last && "rounded-br-2xl",
                      row.highlight && "font-medium",
                    )}
                  >
                    {row.vouch}
                  </div>
                </Reveal>
              );
            })}
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
                      Plain Escrow
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
          <SectionHeading id={SECTION.how}>How a Guarantee Resolves?</SectionHeading>
          <ResolveTimeline />
        </section>

        {/* ===================== CONCRETE EXAMPLE (RECEIPT) ===================== */}
        <section className="py-20 sm:py-24" aria-labelledby="example-heading">
          <SectionHeading id={SECTION.example}>One Bug, From Fee to Payout.</SectionHeading>
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
          <SectionHeading id={SECTION.rails}>What Each Rail Does?</SectionHeading>
          {/* Hover reveal is a desktop nicety (touch has no hover), so the hint + the reveal only apply at lg. */}
          <p className="mx-auto mt-3 hidden max-w-md text-center text-sm text-muted-foreground lg:block">
            Hover a rail to see what it does.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-3 lg:mt-12">
            {INTEGRATIONS.map((it) => (
              <div
                key={it.name}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md lg:min-h-[13rem]"
              >
                <div className="absolute -right-16 -top-16 size-32 rounded-full bg-primary/[0.06] opacity-0 blur-2xl transition-opacity group-hover:opacity-100" />

                {/* Brand logo(s): a static row on mobile/tablet; on lg, a centered overlay that fades on hover. */}
                <div className="flex items-center gap-5 lg:absolute lg:inset-0 lg:justify-center lg:p-6 lg:transition-all lg:duration-300 lg:group-hover:-translate-y-1 lg:group-hover:opacity-0">
                  {it.logos.map((src) => (
                    <img
                      key={src}
                      src={src}
                      alt=""
                      aria-hidden
                      className="h-7 w-auto max-w-[45%] object-contain lg:h-8"
                    />
                  ))}
                </div>

                {/* Explanation: always visible on mobile/tablet; fades in on hover at lg. */}
                <div className="mt-5 lg:relative lg:mt-0 lg:flex lg:h-full lg:min-h-[inherit] lg:flex-col lg:justify-center lg:opacity-0 lg:transition-opacity lg:duration-300 lg:group-hover:opacity-100">
                  <h3 className="font-display text-xl tracking-tight text-foreground lg:text-2xl">{it.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:mt-2.5">{it.body}</p>
                </div>
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
        <div className="mx-auto max-w-5xl px-4 py-24 text-center sm:px-6 sm:py-28">
          <h2 className="mx-auto max-w-4xl font-display text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            Ship Agent Work Clients Trust —{" "}
            <span className="italic text-primary">After the Invoice Clears.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Watch one resolve end to end — locked collateral to a DON-signed payout, live on-chain.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/demo" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "gap-2")}>
              Demo
            </Link>
            <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "group gap-2")}>
              Open App
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
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
      className="mx-auto max-w-3xl scroll-mt-32 text-center font-display text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl"
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
