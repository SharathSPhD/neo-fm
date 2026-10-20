/**
 * The two processes every local Playwright run needs: the fake Supabase and a
 * production `next start` wired to it. Shared by the smoke and visual configs.
 */
import { APP_PORT, FAKE_PORT, smokeEnv } from "./env.mjs";

export const localServers = () => [
  {
    command: "node tests/smoke/fake-supabase.mjs",
    url: `http://127.0.0.1:${FAKE_PORT}/__health`,
    reuseExistingServer: false, // a stale server would silently test old code
  },
  {
    command: `pnpm exec next start -p ${APP_PORT}`,
    url: `http://localhost:${APP_PORT}/api/healthz`,
    env: { ...smokeEnv, PORT: String(APP_PORT) },
    reuseExistingServer: false, // a stale server would silently test old code
    timeout: 120_000,
  },
];
