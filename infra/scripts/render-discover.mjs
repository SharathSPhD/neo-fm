#!/usr/bin/env node
// render-discover.mjs — dispatch real DGX render jobs for the 12 Discover
// catalog songs (v1.5 Sprint 1).
//
// The seed-discover.mjs script creates placeholder `completed` jobs so the
// Discover page renders cards immediately. This script sends proper render
// jobs through the DGX pipeline (PWM → IndicBART → music-inference →
// vocal-synth) so each catalog song gets real audio.
//
// Usage:
//   node infra/scripts/render-discover.mjs [--wait] [--timeout=600]
//
//   --wait           poll until all jobs reach `completed` or `failed`
//                    (default: dispatch and exit)
//   --timeout=N      max seconds to wait when --wait is set (default 600)
//   --manifest=PATH  path to seed-apply-manifest.json for user IDs
//                    (default: demos/v1.4/sprint-15-discover/seed-apply-manifest.json)
//
// Environment:
//   SUPABASE_URL              — required
//   SUPABASE_SERVICE_ROLE_KEY — required
//
// Outputs:
//   demos/v1.4/sprint-15-discover/render-manifest.json  — job IDs per seed

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

// ── CLI flags ─────────────────────────────────────────────────────────────
const FLAGS = process.argv.slice(2);
const WAIT = FLAGS.includes("--wait");
const TIMEOUT_S = Number(
  (FLAGS.find((f) => f.startsWith("--timeout=")) ?? "--timeout=600").split("=")[1],
);
const MANIFEST_ARG = FLAGS.find((f) => f.startsWith("--manifest="));
const SEED_MANIFEST_PATH = MANIFEST_ARG
  ? MANIFEST_ARG.split("=")[1]
  : path.resolve(
      process.cwd(),
      "demos/v1.4/sprint-15-discover/seed-apply-manifest.json",
    );

const OUT_DIR = path.resolve(
  process.cwd(),
  "demos/v1.4/sprint-15-discover",
);
fs.mkdirSync(OUT_DIR, { recursive: true });
const RENDER_MANIFEST_PATH = path.join(OUT_DIR, "render-manifest.json");

const log = (...args) => console.log("[render-discover]", ...args);

// ── Supabase client ───────────────────────────────────────────────────────
function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(2);
  }
  return v;
}

const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(
  need("SUPABASE_URL"),
  need("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// ── Load seed-apply-manifest to get demo user IDs ─────────────────────────
if (!fs.existsSync(SEED_MANIFEST_PATH)) {
  console.error(
    `seed-apply-manifest not found at ${SEED_MANIFEST_PATH}.\n` +
      "Run `node infra/scripts/seed-discover.mjs --apply` first.",
  );
  process.exit(2);
}
const seedManifest = JSON.parse(fs.readFileSync(SEED_MANIFEST_PATH, "utf8"));
/** @type {Map<number, {user_id: string, job_id: string}>} */
const seededBySeedId = new Map(
  (seedManifest.results ?? [])
    .filter((r) => r.user_id && !r.error)
    .map((r) => [r.seed_id, { user_id: r.user_id, job_id: r.job_id }]),
);

// ── Per-style section templates (mirrors apps/web/app/api/songs/route.ts) ─
const SECTION_TEMPLATES = {
  carnatic: ["pallavi", "anupallavi", "charanam", "charanam"],
  hindustani: ["alaap", "mukhda", "antara"],
  "kannada-light-classical": ["mukhda", "antara", "mukhda"],
  "tamil-folk": ["folk_stanza", "folk_refrain", "folk_stanza"],
  "sanskrit-shloka": ["shloka_verse", "shloka_refrain", "shloka_verse", "phalashruti"],
  "bengali-rabindrasangeet": ["mukhda", "antara", "mukhda"],
  "telugu-keerthana": ["pallavi", "anupallavi", "charanam"],
  western: ["intro", "verse", "chorus", "verse", "chorus", "outro"],
};

/** Build a song document suitable for the DGX worker's prompt branch. */
function buildRenderDocument(preset) {
  const sectionTypes =
    SECTION_TEMPLATES[preset.style_family] ??
    SECTION_TEMPLATES["western"];

  const sections = sectionTypes.map((type, i) => ({
    id: `${preset.preset_id}-s${i + 1}`,
    type,
    // No pre-populated lyrics: PWM or IndicBART fills them on DGX.
    voice_id: preset.voice_id,
    target_seconds: 12,
  }));

  return {
    title: preset.title,
    language: preset.language,
    style_family: preset.style_family,
    target_duration_seconds: 60,
    lead_vocal: "auto",
    demo_seed: preset.seed_id,
    // metadata.prompt triggers the PWM lyric-expansion branch in the DGX worker.
    metadata: {
      prompt: buildPrompt(preset),
      is_discover_catalog: true,
    },
    sections,
    structure: sections.map((s) => s.id),
  };
}

function buildPrompt(preset) {
  // Human-readable prompt the PWM world model uses as the seed text for
  // the 5-step warmup in PancakrtyaLoopV2, then as the LyricRequest
  // prompt forwarded to /v1/generate-lyric.
  switch (preset.style_family) {
    case "carnatic":
      return `${preset.title} — a traditional carnatic composition with devotional bhakti mood`;
    case "hindustani":
      return `${preset.title} — an evening raga in the Hindustani classical tradition`;
    case "kannada-light-classical":
      return `${preset.title} — a bhavageete evoking the misty Western Ghats at dusk`;
    case "tamil-folk":
      return `${preset.title} — a Janapada folk song with parai rhythm from rural Tamil Nadu`;
    case "sanskrit-shloka":
      return `${preset.title} — a Sanskrit stotra with sustained chant quality`;
    case "bengali-rabindrasangeet":
      return `${preset.title} — Tagore's song of the land and the soul`;
    case "telugu-keerthana":
      return `${preset.title} — a Telugu keerthana in Mohanam raga`;
    default:
      return preset.title;
  }
}

// ── Dispatch render jobs ───────────────────────────────────────────────────
const DEFAULT_PRESETS = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "demos/v1.4/sprint-15-discover/seed-manifest.json"),
    "utf8",
  ),
).presets;

/** @type {Array<{seed_id: number, preset_id: string, job_id?: string, song_document_id?: string, error?: string}>} */
const results = [];

for (const preset of DEFAULT_PRESETS) {
  const seeded = seededBySeedId.get(preset.seed_id);
  if (!seeded) {
    log(`WARN: seed_id ${preset.seed_id} not found in seed-apply-manifest; skipping`);
    results.push({ seed_id: preset.seed_id, preset_id: preset.preset_id, error: "no seeded user" });
    continue;
  }

  try {
    const userId = seeded.user_id;
    const doc = buildRenderDocument(preset);
    const attemptId = crypto.randomUUID();
    const traceId = crypto.randomUUID();

    // 1. Insert song_document (service role bypasses RLS).
    const { data: docRow, error: docErr } = await supabase
      .from("song_documents")
      .insert({
        user_id: userId,
        language: preset.language,
        style_family: preset.style_family,
        document_json: doc,
        title: preset.title,
      })
      .select("id")
      .single();
    if (docErr) throw new Error(`insert song_documents: ${docErr.message}`);

    // 2. Insert job with status='queued'.
    const { data: jobRow, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        song_document_id: docRow.id,
        status: "queued",
        priority: 1,   // priority=1 → 'high' in pgmq payload
        progress: 0,
        attempts: 0,
        attempt_id: attemptId,
        trace_id: traceId,
      })
      .select("id")
      .single();
    if (jobErr) throw new Error(`insert jobs: ${jobErr.message}`);

    // 3. Enqueue via the SECURITY DEFINER helper (same payload shape as create_song_job).
    const payload = {
      job_id: jobRow.id,
      user_id: userId,
      song_document_id: docRow.id,
      priority: "high",
      created_at: new Date().toISOString(),
      style_family: preset.style_family,
      target_duration_seconds: 60,
      attempt_id: attemptId,
      attempt_number: 1,
      trace_id: traceId,
    };
    const { error: enqErr } = await supabase.rpc("enqueue_song_generation_job", {
      payload,
    });
    if (enqErr) throw new Error(`enqueue: ${enqErr.message}`);

    results.push({
      seed_id: preset.seed_id,
      preset_id: preset.preset_id,
      user_id: userId,
      job_id: jobRow.id,
      song_document_id: docRow.id,
      trace_id: traceId,
    });
    log(`seed ${preset.seed_id} → job ${jobRow.id} (${preset.preset_id}) queued`);
  } catch (err) {
    log(`ERROR seed ${preset.seed_id}: ${err}`);
    results.push({ seed_id: preset.seed_id, preset_id: preset.preset_id, error: String(err) });
  }
}

// Write initial manifest.
const renderManifest = {
  generated_at: new Date().toISOString(),
  dispatched: results.filter((r) => r.job_id).length,
  failed_dispatch: results.filter((r) => r.error).length,
  results,
};
fs.writeFileSync(RENDER_MANIFEST_PATH, `${JSON.stringify(renderManifest, null, 2)}\n`);
log(`wrote render manifest → ${RENDER_MANIFEST_PATH}`);

if (!WAIT) {
  log(`dispatched ${renderManifest.dispatched}/${DEFAULT_PRESETS.length} jobs. Pass --wait to poll.`);
  process.exit(renderManifest.failed_dispatch > 0 ? 1 : 0);
}

// ── Poll until complete ────────────────────────────────────────────────────
log(`--wait: polling until all jobs complete (timeout ${TIMEOUT_S}s)…`);
const jobIds = results.filter((r) => r.job_id).map((r) => r.job_id);
const deadline = Date.now() + TIMEOUT_S * 1000;
const POLL_INTERVAL_MS = 10_000;

while (Date.now() < deadline) {
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("id, status, progress")
    .in("id", jobIds);

  if (error) {
    log(`poll error: ${error.message}`);
  } else {
    const done = rows.filter((r) => r.status === "completed" || r.status === "failed");
    log(`${done.length}/${jobIds.length} done`);

    if (done.length === jobIds.length) {
      // Fetch final audio URLs from tracks table.
      const { data: tracks } = await supabase
        .from("tracks")
        .select("job_id, audio_url, duration_seconds")
        .in("job_id", jobIds);

      const trackByJobId = Object.fromEntries(
        (tracks ?? []).map((t) => [t.job_id, t]),
      );

      // Patch results with final status + audio URLs.
      for (const r of results) {
        const row = rows.find((j) => j.id === r.job_id);
        const track = trackByJobId[r.job_id];
        if (row) r.final_status = row.status;
        if (track) {
          r.audio_url = track.audio_url;
          r.duration_seconds = track.duration_seconds;
        }
      }
      const finalManifest = { ...renderManifest, results, completed_at: new Date().toISOString() };
      fs.writeFileSync(RENDER_MANIFEST_PATH, `${JSON.stringify(finalManifest, null, 2)}\n`);
      log("all jobs settled — render-manifest.json updated with audio URLs");
      const failed = results.filter((r) => r.final_status === "failed");
      process.exit(failed.length > 0 ? 1 : 0);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

log(`TIMEOUT after ${TIMEOUT_S}s — some jobs still running`);
process.exit(1);
