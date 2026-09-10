# @vouch/ui

Shared shadcn/ui primitives and Tailwind v4 tokens used by the apps (primarily `@vouch/web`).

## Responsibilities
- Host copied shadcn/ui primitives (button, card, table, badge, …) as source components.
- Provide shared Tailwind v4 design tokens/styles.
- Keep `components.json` (shadcn config) as the source for adding new primitives.

## Non-responsibilities
- Not an app-specific component library — composite/app-specific components live in each app's own
  `components/`.
- Holds no business logic, data fetching, chain calls, or secrets.
- Not a runtime dependency in the published sense — components are copied into the repo, and
  consumers must `@source`/`transpilePackages` this package so Tailwind v4 detects its classes.
