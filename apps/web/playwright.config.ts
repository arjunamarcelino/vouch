import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config (WS-10). Drives the web app against a dev server. The runnable specs
 * (landing/demo/responsive/nav) exercise the UI in simulation mode — no API or wallet required, so they
 * pass in CI out of the box. The wallet+API flow specs (happy-path, claim-path) self-skip unless
 * `E2E_LIVE=1` (they need the NestJS API, a seeded DB, and a signer). `PLAYWRIGHT_BASE_URL` overrides the
 * target; otherwise Playwright starts `next dev` on :3000.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
