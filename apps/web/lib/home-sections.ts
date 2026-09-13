/**
 * Single source of truth for the landing's in-page sections. Both the page (heading ids /
 * scroll-anchor targets) and the header (nav links + scroll-spy) import from here, so the two can't
 * drift and a renamed/removed section is a compile error rather than a silently-dead anchor.
 */
export const SECTION = {
  top: "top",
  compare: "compare-heading",
  how: "how-heading",
  example: "example-heading",
  rails: "arch-heading",
} as const;

export const HOME_NAV: { href: string; label: string }[] = [
  { href: `#${SECTION.top}`, label: "Home" },
  { href: `#${SECTION.compare}`, label: "Compare" },
  { href: `#${SECTION.how}`, label: "How It Works" },
  { href: `#${SECTION.example}`, label: "Example" },
  { href: `#${SECTION.rails}`, label: "Rails" },
];
