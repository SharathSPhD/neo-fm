#!/usr/bin/env node
// v1.4 seed-discover.mjs — populate `/discover` with demo songs.
//
// Sprint 1 ships the scaffold (idempotent, dry-run by default, no DB
// writes when no presets are listed). Sprint 15 fills in the demo
// matrix once the v1.4 trained adapters and presets are live.
//
// Usage:
//   node infra/scripts/seed-discover.mjs [--apply] [--reset]
//
//   --apply      perform writes against Supabase via the service role
//   --reset      delete previously-seeded rows (matched by owner email
//                pattern `demo-seed-N@neo-fm.demo`) before re-inserting
//
// The default invocation is dry-run: prints what WOULD happen but
// touches nothing. CI always runs in dry-run.
//
// Environment:
//   SUPABASE_URL                — required for --apply
//   SUPABASE_SERVICE_ROLE_KEY   — required for --apply
//   SEED_PRESETS                — optional JSON array overriding the
//                                  in-file PRESETS constant
//
// Outputs a JSON manifest to demos/v1.4/sprint-15-discover/seed-manifest.json
// describing the (planned or executed) rows.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FLAGS = new Set(process.argv.slice(2));
const APPLY = FLAGS.has("--apply");
const RESET = FLAGS.has("--reset");

const OUT_DIR = path.resolve(
  process.cwd(),
  "demos/v1.4/sprint-15-discover",
);
fs.mkdirSync(OUT_DIR, { recursive: true });
const MANIFEST_PATH = path.join(OUT_DIR, "seed-manifest.json");

const log = (...args) => console.log("[seed-discover]", ...args);

// Sprint-1 scaffold: the matrix is intentionally empty until Sprint 15
// wires up the trained adapters. Override via SEED_PRESETS for local
// experiments.
const DEFAULT_PRESETS = [];
const PRESETS = (() => {
  if (process.env.SEED_PRESETS) {
    try {
      return JSON.parse(process.env.SEED_PRESETS);
    } catch (err) {
      log("WARN: SEED_PRESETS is not valid JSON; ignoring");
      log(err);
    }
  }
  return DEFAULT_PRESETS;
})();

const manifest = {
  apply: APPLY,
  reset: RESET,
  generated_at: new Date().toISOString(),
  preset_count: PRESETS.length,
  presets: PRESETS,
};

fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
log(`wrote manifest -> ${MANIFEST_PATH}`);

if (!APPLY) {
  log("dry-run (default). Pass --apply to actually write.");
  log(`planned demo songs: ${PRESETS.length}`);
  process.exit(0);
}

if (PRESETS.length === 0) {
  log("no presets supplied; nothing to do.");
  process.exit(0);
}

// --apply path. We defer the @supabase/supabase-js require so the
// scaffold runs without pnpm install in CI.
const { createClient } = await import("@supabase/supabase-js");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(2);
  }
  return v;
}

const supabase = createClient(
  need("SUPABASE_URL"),
  need("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

if (RESET) {
  log("RESET: deleting prior demo-seed rows (placeholder; finalised in Sprint 15)");
  // Sprint 15 fills in the explicit cleanup logic. Until then, an
  // empty reset is safe.
}

// Sprint 15 fills in the row-insertion logic. We exit cleanly so
// `--apply` in pre-Sprint-15 CI does not error out.
log("PRESETS materialisation not implemented yet; finalised in Sprint 15.");
process.exit(0);
