/**
 * Visual-regression suite: full-page screenshots of the key pages across
 * UI language x viewport x theme, against the same local production build and
 * in-memory fake Supabase the smoke suite uses (no real backend, no spend).
 *
 *   pnpm --filter @neo-fm/web test:visual            compare against baselines
 *   pnpm --filter @neo-fm/web test:visual:update     rewrite baselines
 *
 * Baselines are rendered by Linux Chromium with the Noto Indic fonts installed
 * (see .github/workflows/visual.yml), so they only match that environment:
 * regenerate them in CI (push a commit whose message contains [update-visual]).
 */
import { defineConfig } from "@playwright/test";

import { APP_PORT } from "./tests/smoke/env.mjs";
import { localServers } from "./tests/smoke/servers.mjs";

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: /.*\.(spec|setup)\.ts/,
  outputDir: "./tests/visual/.output", // actual / expected / diff PNGs of any failure
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  reporter: [["list"], ["html", { outputFolder: "./tests/visual/.report", open: "never" }]],
  workers: 2,
  retries: 0, // a retry would hide a flaky screenshot instead of exposing it
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.002, threshold: 0.2 },
  },
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    headless: true,
    deviceScaleFactor: 1,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    launchOptions: {
      executablePath: process.env.E2E_CHROMIUM,
      // Pin text rendering: LCD vs greyscale anti-aliasing flips with compositing
      // state and made identical pages differ run to run.
      args: ["--disable-lcd-text", "--font-render-hinting=none", "--force-color-profile=srgb"],
    },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "visual", testMatch: /visual\.spec\.ts/, dependencies: ["setup"] },
  ],
  webServer: localServers(),
});
