import { cn } from "@vouch/ui/lib/utils";

/**
 * "Built on" strip of the stack we actually use. Theme-aware: each mark ships a light-theme
 * variant (dark ink / brand color) and a dark-theme variant (white); USDC is full-color for both.
 * Official brand assets only, unmodified (per each brand's guidelines) — served from /public/logos.
 */
type Mark = {
  name: string;
  href: string;
  light: string; // shown in the light theme
  dark?: string; // shown in the dark theme (omit when one asset works on both)
};

const MARKS: Mark[] = [
  {
    name: "Arc",
    href: "https://www.arc.io",
    light: "/logos/arc/Arc_Logo_Navy.svg",
    dark: "/logos/arc/Arc_Logo_White.svg",
  },
  {
    name: "Circle",
    href: "https://www.circle.com",
    light: "/logos/circle/circle-logo-licorice.svg",
    dark: "/logos/circle/circle-logo-white.svg",
  },
  {
    name: "The Graph",
    href: "https://thegraph.com",
    // Named by ink color (like every other mark: dark slot → the *white* asset), not by theme.
    light: "/logos/the-graph/the-graph-ink.svg",
    dark: "/logos/the-graph/the-graph-white.svg",
  },
  {
    name: "Chainlink",
    href: "https://chain.link",
    light: "/logos/chainlink/Chainlink-Logo-Blue.svg",
    dark: "/logos/chainlink/Chainlink-Logo-White.svg",
  },
  {
    name: "USDC",
    href: "https://www.circle.com/usdc",
    light: "/logos/usdc/usdc.svg", // full-color coin — same on both themes
  },
];

export function TechStrip({
  label = "Built on",
  className,
  size = "md",
}: {
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const h = size === "sm" ? "h-5" : "h-6";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-8 gap-y-4", className)}>
      {label ? (
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      ) : null}
      {MARKS.map((m) => (
        <a
          key={m.name}
          href={m.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={m.name}
          title={m.name}
          className="inline-flex items-center opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Both variants are decorative; the anchor's aria-label is the sole accessible name. */}
          <img src={m.light} alt="" aria-hidden className={cn(h, "w-auto", m.dark && "dark:hidden")} />
          {m.dark ? (
            <img src={m.dark} alt="" aria-hidden className={cn("hidden w-auto dark:block", h)} />
          ) : null}
        </a>
      ))}
    </div>
  );
}
