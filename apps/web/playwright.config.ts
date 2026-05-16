/**
 * Playwright test runner for end-to-end UI specs (Sprint 7.3 / 7.4).
 *
 * - All specs run against the live `neo-fm-web.vercel.app` deployment
 *   by default; override with `E2E_BASE_URL` when running against a
 *   local dev server.
 * - Each spec is a thin pump on top of the smoke-scripts we ran in
 *   Sprints 5c/6/7.2; the shared helpers live in `tests/e2e/helpers/`.
 * - Headless chromium only — webkit/firefox parity isn't a v1.2 ask.
 * - axe-core runs inside each spec (Sprint 7.4); we fail the suite on
 *   critical or serious violations.
 *
 * Run:
 *   pnpm playwright test                       # full suite
 *   pnpm playwright test tests/e2e/auth.spec   # one spec
 *   pnpm playwright test --headed              # debug
 */
import { defineConfig } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "https://neo-fm-web.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  // Vitest owns ./tests; explicitly include only the e2e subdir so
  // running playwright doesn't accidentally try to run vitest specs.
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // smoke user is shared; serial is safer.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "./tests/e2e/.playwright-report", open: "never" },
    ],
  ],
  outputDir: "./tests/e2e/.playwright-output",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
