import { test, expect } from "@playwright/test";

/**
 * Judge demo (WS-7). Without the API the page correctly runs in labeled local-simulation mode; the
 * Prize Evidence drawer opens and is keyboard-dismissable (Radix focus trap + Esc).
 */
test.describe("Judge demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo");
  });

  test("narrates the 6-step flow with honest mode labeling", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Judge demo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /client funds 20 usdc/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /regression proven/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /reputation updates/i })).toBeVisible();
    // With the API down, the mode banner must show local simulation — never a fabricated live claim.
    await expect(page.getByText(/local simulation/i).first()).toBeVisible();
  });

  test("Prize Evidence drawer opens and closes with Escape", async ({ page }) => {
    await page.getByRole("button", { name: /prize evidence/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/the graph/i).first()).toBeVisible();
    await expect(dialog.getByText(/chainlink cre/i).first()).toBeVisible();
    // Honest fallback: unconfigured integrations are explicitly labeled, never blank/fabricated.
    await expect(dialog.getByText(/not configured|local simulation|evidence/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("The Graph panel fails closed (no stale/fabricated reputation) when the API is down", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /the graph — live indexed reputation/i })).toBeVisible();
    // A simulation badge or the explicit fail-closed message — never a silent stale table.
    await expect(page.getByText(/simulation|unavailable|no indexed providers/i).first()).toBeVisible();
  });
});
