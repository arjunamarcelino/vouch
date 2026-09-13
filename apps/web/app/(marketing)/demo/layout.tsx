import type { ReactNode } from "react";
import { StatusBar } from "../../../components/shell/StatusBar";

/**
 * The public demo keeps the app's Live/Networks status footer (review 107) — it's the one marketing
 * surface that surfaces integration health. Mounting StatusBar here (rather than self-gating it in the
 * root layout) is why StatusBar no longer needs a `pathname` predicate.
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <StatusBar />
    </>
  );
}
