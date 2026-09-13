import { cn } from "@vouch/ui/lib/utils";
import { MARKS, type Mark } from "./TechStrip";

/**
 * Seamless, non-stop, one-direction logo marquee for the "built on" section. The track renders the
 * mark set TWICE and animates translateX to -50% (see `.animate-marquee` in globals.css), so the wrap
 * point lands exactly where the first copy began — no visible seam. Edge fade masks the entry/exit.
 * Theme-aware assets (each mark ships a light + optional dark variant), official brand marks only.
 * Pauses on hover for legibility; freezes entirely under prefers-reduced-motion.
 */
function LogoItem({ mark, h }: { mark: Mark; h: string }) {
  return (
    <a
      href={mark.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={mark.name}
      title={mark.name}
      className="inline-flex shrink-0 items-center px-8 opacity-65 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-10"
    >
      <img src={mark.light} alt="" aria-hidden className={cn(h, "w-auto", mark.dark && "dark:hidden")} />
      {mark.dark ? (
        <img src={mark.dark} alt="" aria-hidden className={cn("hidden w-auto dark:block", h)} />
      ) : null}
    </a>
  );
}

export function LogoMarquee({ className, height = "h-8" }: { className?: string; height?: string }) {
  // Duplicated once → the -50% shift equals exactly one copy width for a seamless loop.
  const loop = [...MARKS, ...MARKS];
  return (
    <div
      className={cn(
        "group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_7%,#000_93%,transparent)]",
        className,
      )}
    >
      <div className="animate-marquee flex w-max items-center">
        {loop.map((mark, i) => (
          <LogoItem key={`${mark.name}-${i}`} mark={mark} h={height} />
        ))}
      </div>
    </div>
  );
}
