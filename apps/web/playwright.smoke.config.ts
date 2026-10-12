/**
 * Smoke suite for core flows.
 *
 *   Local (default, what CI runs):  pnpm test:smoke
 *     Builds the app against an in-memory fake Supabase and runs the specs
 *     with no real backend, Lyria, Anthropic or prod writes.
 *
 *   Preview-URL mode (manual):  SMOKE_BASE_URL=https://<preview> pnpm test:smoke
 *     Runs only the read-only specs (landing, pricing, trust, auth pages,
 *     public song page/report UI). Specs that sign in or create songs are
 *     skipped so nothing is written to a shared environment.
 */
import { defineConfig } from "@playwright/test";

import { APP_PORT, FAKE_PORT, smokeEnv } from "./tests/smoke/env.mjs";

// CI passes an empty string when the manual input is blank, so use `||`, not `??`.
const REMOTE = process.env.SMOKE_BASE_URL || undefined;
const proxy = REMOTE ? process.env.HTTPS_PROXY : undefined;

export default defineConfig({
  testDir: "./tests/smoke",
  testMatch: /.*\.spec\.ts/,
  outputDir: "./tests/smoke/.output",
  reporter: [["list"], ["html", { outputFolder: "./tests/smoke/.report", open: "never" }]],
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: REMOTE ?? `http://localhost:${APP_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.E2E_CHROMIUM,
      proxy: proxy ? { server: proxy, bypass: "localhost,127.0.0.1" } : undefined,
    },
  },
  webServer: REMOTE
    ? undefined
    : [
        {
          command: "node tests/smoke/fake-supabase.mjs",
          url: `http://127.0.0.1:${FAKE_PORT}/__health`,
          reuseExistingServer: false, // a stale server would silently test old code
        },
        {
          command: `pnpm exec next start -p ${APP_PORT}`,
          url: `http://localhost:${APP_PORT}/api/healthz`,
          env: { ...smokeEnv, PORT: String(APP_PORT) } as Record<string, string>,
          reuseExistingServer: false, // a stale server would silently test old code
          timeout: 120_000,
        },
      ],
});
