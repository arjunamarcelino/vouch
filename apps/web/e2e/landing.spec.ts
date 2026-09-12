import { test, expect } from "@playwright/test";

/**
 * Landing (WS-1) — the 20-second test. Renders fully without a wallet or the API running.
 */
test.describe("Landing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("states the problem, the comparison, and the flow", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/protect the work/i);
    // Escrow vs post-completion assurance comparison is present (row values render at all widths).
    await expect(page.getByRole("heading", { name: /escrow vs\. post-completion assurance/i })).toBeVisible();
    await expect(page.getByText(/after acceptance/i).first()).toBeVisible();
    // Three rails summary.
    await expect(page.getByText("The Graph", { exact: true })).toBeVisible();
    await expect(page.getByText("Chainlink CRE", { exact: true })).toBeVisible();
    // Concrete example uses exact USDC amounts.
    await expect(page.getByText(/20 USDC/).first()).toBeVisible();
    await expect(page.getByText(/100 USDC/).first()).toBeVisible();
  });

  test("the primary CTA opens the demo and is keyboard reachable", async ({ page }) => {
    const cta = page.getByRole("link", { name: /open judge demo/i });
    await expect(cta).toBeVisible();
    await cta.focus();
    await expect(cta).toBeFocused();
    await cta.click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("renders without a wallet connected (no crash)", async ({ page }) => {
    await expect(page.getByText(/not a marketplace\. not insurance\. not plain escrow\./i)).toBeVisible();
  });
});
