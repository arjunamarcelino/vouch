import { test, expect } from "@playwright/test";

/**
 * Successful post-completion claim path (WS-10): on a covered, InitiallyApproved job the client opens a
 * claim with an evidence commitment → the CRE confidential evaluation runs → a COVERED_PAID verdict pays
 * the guarantee → the provider's reputation reflects the upheld claim. Runs only with `E2E_LIVE=1`
 * against the API + a seeded job in coverage (and the CRE sim/relay producing a covered verdict).
 */
const LIVE = process.env.E2E_LIVE === "1";
const JOB = process.env.E2E_COVERED_JOB_ID ?? "";

test.describe("Claim path — open claim → CRE verdict → payout", () => {
  test.skip(!LIVE, "requires E2E_LIVE=1 (API + a seeded InitiallyApproved job in coverage + CRE verdict)");

  test("opens a claim, evaluates confidentially, and pays out on a covered verdict", async ({ page }) => {
    await page.goto(`/jobs/${JOB}/claim`);

    // Eligible: the evidence form is shown; commit the evidence (hashed client-side).
    await page.getByRole("textbox").first().fill("Regression: login returns 500 on valid credentials.");
    await page.getByRole("button", { name: /open claim/i }).click();

    // Receipt-gated: submitted → confirmed; never success before the receipt.
    await expect(page.getByText(/waiting for confirmation/i)).toBeVisible();
    await expect(page.getByText(/confirmed on-chain|done/i)).toBeVisible({ timeout: 60_000 });

    // CRE runs, then the minimal public verdict resolves to a covered payout.
    await expect(page.getByText(/confidential evaluation running/i)).toBeVisible();
    await expect(page.getByText(/covered failure proven — guarantee paid/i)).toBeVisible({ timeout: 120_000 });

    // The upheld claim shows on the provider's Graph-indexed reputation.
    await page.goto(`/providers/${process.env.E2E_PROVIDER ?? ""}`);
    await expect(page.getByText(/claims upheld/i)).toBeVisible();
  });
});
