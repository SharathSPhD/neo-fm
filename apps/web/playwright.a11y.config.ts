/**
 * Playwright config for the PR-time accessibility gate (tests/a11y).
 *
 * Unlike playwright.config.ts this needs no deployed site, secrets or
 * signed-in user: CI builds the app, starts `next start` and points
 * E2E_BASE_URL at it. Only public pages are covered here; the
 * signed-in pages are covered by the nightly e2e suite.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/a11y",
  testMatch: /.*\.a11y\.ts/,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
    viewport: { width: 1280, height: 900 },
  },
});
