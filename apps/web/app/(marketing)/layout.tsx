import type { ReactNode } from "react";
import { SiteHeader } from "../../components/shell/SiteHeader";
import { SiteFooter } from "../../components/shell/SiteFooter";

/**
 * Marketing chrome (review 107): the floating header + "built-on" footer for the public surface (`/`
 * and `/demo`). The gated app (`/app/*`) and the login screen live outside this route group and render
 * their own chrome, so none of these components self-gate on `pathname` any more.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
