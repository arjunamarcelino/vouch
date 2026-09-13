"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@vouch/ui/lib/utils";

/**
 * Landing motion primitives (client). Small, dependency-free building blocks:
 *   - <Reveal>   scroll-triggered fade/slide/de-blur (once), with an optional stagger delay.
 *   - <CountUp>  eased number count-up the first time it scrolls into view.
 * Both degrade gracefully — they show final state immediately if IntersectionObserver is missing, and
 * the CSS side already no-ops ambient motion under prefers-reduced-motion.
 */

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        "transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity] motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100 blur-0" : "translate-y-8 opacity-0 blur-[3px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CountUp({
  to,
  duration = 1500,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: {
  to: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setValue(to);
      return;
    }
    let rafId = 0;
    const cancel = { done: false };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || started.current) return;
        started.current = true;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          if (cancel.done) return;
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setValue(to * eased);
          if (p < 1) rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    // Cancel the rAF chain on unmount so it can't keep setting state after teardown.
    return () => {
      cancel.done = true;
      cancelAnimationFrame(rafId);
      io.disconnect();
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}
