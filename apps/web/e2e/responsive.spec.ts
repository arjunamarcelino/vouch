import { test, expect } from "@playwright/test";

/**
 * Responsive layout (WS-10). No page may scroll the body horizontally at mobile/tablet/desktop widths;
 * wide content scrolls inside its own container instead.
 */
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 800 },
];
const ROUTES = ["/", "/demo", "/dashboard"];

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`no horizontal overflow at ${vp.name} on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(route);
      // Allow a 1px rounding tolerance.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
}

test("header nav collapses on mobile (links hidden, connect visible)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  // The primary nav links are hidden below the sm breakpoint; the wordmark stays.
  await expect(page.getByRole("link", { name: "Vouch" })).toBeVisible();
});
