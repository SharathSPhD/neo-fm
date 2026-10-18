/**
 * Local smoke runner: builds the app against the fake Supabase (NEXT_PUBLIC_*
 * is inlined at build time), then runs the smoke suite, which boots the fake
 * backend and `next start` itself. Set SMOKE_SKIP_BUILD=1 to reuse `.next`.
 */
import { spawnSync } from "node:child_process";

import { smokeEnv } from "../tests/smoke/env.mjs";

const env = { ...process.env, ...smokeEnv };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!process.env.SMOKE_SKIP_BUILD) run("pnpm", ["exec", "next", "build"]);
run("pnpm", ["exec", "playwright", "test", "-c", "playwright.smoke.config.ts", ...process.argv.slice(2)]);
