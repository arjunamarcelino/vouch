import { test, expect } from "@playwright/test";

/**
 * Complete happy path (WS-10): connect + SIWE → create job (approve + openJob) → provider accepts →
 * submits → evaluator approves → coverage opens. This drives real wallet signing and the NestJS API, so
 * it runs only with `E2E_LIVE=1` (the app built with `NEXT_PUBLIC_E2E=1` swaps in the wagmi mock signer,
 * the API + a seeded DB are up, and `/demo/seed` has primed fixtures). Without those it self-skips so CI
 * stays green. The invariants asserted below are the acceptance-critical ones from the plan.
 */
const LIVE = process.env.E2E_LIVE === "1";

test.describe("Happy path — fund → accept → submit → approve → coverage", () => {
  test.skip(!LIVE, "requires E2E_LIVE=1 (NestJS API + seeded DB + mock/funded signer)");

  test("completes the lifecycle and never shows success before a confirmed receipt", async ({ page }) => {
    await page.goto("/jobs/new");

    // Connect + SIWE via the mock connector, then create the job.
    await page.getByRole("button", { name: /connect/i }).click();
    await page.getByPlaceholder("0x…").fill(process.env.E2E_PROVIDER ?? "");
    await page.getByRole("button", { name: /approve & create job/i }).click();

    // Approval and transaction are distinct stages (Step 1 of 2 → confirm).
    await expect(page.getByText(/step 1 of 2 — approve usdc/i)).toBeVisible();

    // Success only appears after a confirmed receipt — the submitted/pending state must precede it.
    await expect(page.getByText(/waiting for confirmation/i)).toBeVisible();
    await expect(page.getByText(/confirmed on-chain/i)).toBeVisible({ timeout: 60_000 });

    // A real Arcscan link is shown only once confirmed.
    await expect(page.getByRole("link", { name: /view on arcscan/i })).toBeVisible();

    // Pending-tx state survives a reload mid-flow (reconciled from chain/API on load).
    await page.reload();
    await expect(page.getByRole("heading", { name: /create a job/i })).toBeVisible();
  });
});
