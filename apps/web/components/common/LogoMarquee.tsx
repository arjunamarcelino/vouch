import { cn } from "@vouch/ui/lib/utils";
import { MARKS, type Mark } from "./TechStrip";

/**
 * Seamless, non-stop, one-direction logo marquee for the "built on" section. The track renders the mark
 * set THREE times and animates translateX to -100%/3 (see `.animate-marquee` in globals.css), so the
 * wrap lands exactly where the first copy began (no seam) and two copies always span the container.
 * Only the FIRST copy is exposed to assistive tech / the tab order; the two duplicates are `aria-hidden`
 * + `tabindex=-1` so brands aren't announced/tabbed three times. Edge fade masks the entry/exit; pauses
 * on hover; freezes under prefers-reduced-motion.
 */
function LogoItem({ mark, h, decorative }: { mark: Mark; h: string; decorative?: boolean }) {
  return (
    <a
      href={mark.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={decorative ? undefined : mark.name}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
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
  // Tripled → the -100%/3 shift equals exactly one copy for a seamless loop, and two copies always
  // span the container so no trailing gap shows when a single set is narrower than the viewport.
  const loop = [...MARKS, ...MARKS, ...MARKS];
  return (
    <div
      className={cn(
        "group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_7%,#000_93%,transparent)]",
        className,
      )}
    >
      <div className="animate-marquee flex w-max items-center">
        {loop.map((mark, i) => (
          <LogoItem key={`${mark.name}-${i}`} mark={mark} h={height} decorative={i >= MARKS.length} />
        ))}
      </div>
    </div>
  );
}
