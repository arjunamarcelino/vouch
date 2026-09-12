import { test, expect } from "@playwright/test";

/**
 * Navigation + unauthenticated states (WS-10). The header routes between pages; gated pages prompt to
 * connect rather than crashing or showing an indefinite spinner.
 */
test("header navigates to the demo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Judge demo", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "Judge demo" })).toBeVisible();
});

test("dashboard prompts to connect when unauthenticated", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(/connect your wallet and sign in/i)).toBeVisible();
});

test("create-job prompts to connect when unauthenticated", async ({ page }) => {
  await page.goto("/jobs/new");
  await expect(page.getByRole("heading", { name: /create a job/i })).toBeVisible();
  await expect(page.getByText(/connect your wallet and sign in to create a job/i)).toBeVisible();
});

test("provider profile shows a graceful state for an address with no indexed history", async ({ page }) => {
  // With the API down this surfaces the fail-closed/unavailable state rather than fabricating data.
  await page.goto("/providers/0x1111111111111111111111111111111111111111");
  await expect(page.getByRole("heading", { name: "Provider" })).toBeVisible();
});
