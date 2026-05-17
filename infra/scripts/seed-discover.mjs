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

// Sprint 15 final matrix: 12 demo songs that exercise every v1.4
// style family, every newly-added voice backend, and every music
// engine routing path. Owners are deterministic so re-runs are
// idempotent against the `demo-seed-N@neo-fm.demo` email pattern.
//
// The matrix mirrors the plan §15 table. When a preset ships a
// `voice_id`, the dgx-worker routes through that catalogue entry
// (which carries the backend); when it ships a `style_family`, the
// music-inference router picks heartmula or musicgen per
// `_DEFAULT_ROUTE_TABLE` in services/music-inference/app/routing.py.
const DEFAULT_PRESETS = [
  {
    seed_id: 1,
    preset_id: "carnatic-kriti",
    title: "Kalyani Kriti — Saraswati Vandana",
    language: "hi",
    style_family: "carnatic",
    voice_id: "indic_hi_female_lyrical",
    music_engine: "musicgen+carnatic-lora",
  },
  {
    seed_id: 2,
    preset_id: "carnatic-kriti-kn",
    title: "Mohanam Kriti — Bhavayami",
    language: "kn",
    style_family: "carnatic",
    voice_id: "indic_kn_female_bhajan",
    music_engine: "musicgen+carnatic-lora",
  },
  {
    seed_id: 3,
    preset_id: "hindustani-khayal-sketch",
    title: "Yaman Khayal — Late evening",
    language: "hi",
    style_family: "hindustani",
    voice_id: "indic_hi_male_broadcast",
    music_engine: "musicgen+hindustani-lora",
  },
  {
    seed_id: 4,
    preset_id: "kannada-bhavageete",
    title: "Bhavageete — Malenaada Maleya Sanje",
    language: "kn",
    style_family: "kannada-light-classical",
    voice_id: "indic_kn_male_warm",
    music_engine: "heartmula+bhavageete-lora",
  },
  {
    seed_id: 5,
    preset_id: "tamil-folk",
    title: "Janapada Parai — Parai vaaikku",
    language: "ta",
    style_family: "tamil-folk",
    voice_id: "indic_ta_male_nadaswaram",
    music_engine: "heartmula+tamil-folk-lora",
  },
  {
    seed_id: 6,
    preset_id: "kabir-doha",
    title: "Kabir doha — Pothi padhi padhi",
    language: "hi",
    style_family: "hindustani",
    voice_id: "chant_devotional",
    music_engine: "heartmula",
  },
  {
    seed_id: 7,
    preset_id: "tagore-set",
    title: "Tagore — Where the mind is without fear",
    language: "en",
    style_family: "western",
    voice_id: "indic_bn_male_rabindra",
    music_engine: "heartmula",
  },
  {
    seed_id: 8,
    preset_id: "bollywood-ballad",
    title: "Bollywood ballad — Tujhse naraz",
    language: "hi",
    style_family: "western",
    voice_id: "indic_hi_female_lyrical",
    music_engine: "heartmula",
  },
  {
    seed_id: 9,
    preset_id: "western-pop",
    title: "Western pop — Heyday",
    language: "en",
    style_family: "western",
    voice_id: "en_in_female_rj",
    music_engine: "heartmula",
  },
  {
    seed_id: 10,
    preset_id: "sanskrit-shloka",
    title: "Sanskrit shloka — Dvadashakshara",
    language: "sa",
    style_family: "sanskrit-shloka",
    voice_id: "chant_sustained",
    music_engine: "heartmula+chant-style-lora",
  },
  {
    seed_id: 11,
    preset_id: "bengali-rabindrasangeet",
    title: "Rabindrasangeet — Amar shonar Bangla",
    language: "bn",
    style_family: "bengali-rabindrasangeet",
    voice_id: "indic_bn_female",
    music_engine: "heartmula",
  },
  {
    seed_id: 12,
    preset_id: "telugu-keerthana",
    title: "Telugu keerthana — Mohanam",
    language: "te",
    style_family: "telugu-keerthana",
    voice_id: "indic_te_male",
    music_engine: "musicgen+carnatic-lora",
  },
];
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

// Sprint 15 --apply implementation.
//
// Rendering 12 demo songs requires the trained v1.4 adapters on DGX
// (heartmula+bhavageete, heartmula+tamil-folk, musicgen+carnatic-lora,
// musicgen+hindustani-lora, IndicF5, NeMo Kannada, chant style LoRA).
// Those artefacts are produced by Sprints 7-14 on the GB10 box and
// uploaded to Supabase Storage out-of-band (see plan §15).
//
// This script's job is the catalog half: ensure 12 demo users exist,
// insert one song_document + one job per preset, and publish each
// public via the existing publish_song RPC.  When --audio-manifest is
// passed, it links each row to a pre-uploaded audio_url; otherwise
// rows are inserted as `completed` with audio_url=NULL (Discover still
// renders the cover and metadata, but playback is gated until the
// render is uploaded — useful for staging environments).
//
// The script is idempotent: it looks up the demo user by email and
// reuses prior song_document/job rows when a `seed_id` is already
// recorded in document_json.demo_seed.

const AUDIO_MANIFEST_FLAG = "--audio-manifest=";
const audioManifestArg = process.argv
  .slice(2)
  .find((a) => a.startsWith(AUDIO_MANIFEST_FLAG));
const AUDIO_MANIFEST_PATH = audioManifestArg
  ? audioManifestArg.slice(AUDIO_MANIFEST_FLAG.length)
  : null;
let audioManifest = /** @type {Record<string, { audio_url: string, duration_seconds?: number }>} */ ({});
if (AUDIO_MANIFEST_PATH) {
  try {
    const raw = fs.readFileSync(AUDIO_MANIFEST_PATH, "utf8");
    audioManifest = JSON.parse(raw);
    log(`loaded audio manifest -> ${AUDIO_MANIFEST_PATH}`);
  } catch (err) {
    console.error(`failed to read audio manifest: ${err}`);
    process.exit(2);
  }
}

function buildSongDocument(preset) {
  const sectionType = (() => {
    switch (preset.style_family) {
      case "carnatic":
      case "hindustani":
        return "pallavi";
      case "sanskrit-shloka":
        return "shloka_verse";
      default:
        return "verse";
    }
  })();
  return {
    title: preset.title,
    language: preset.language,
    style_family: preset.style_family,
    target_duration_seconds: 60,
    lead_vocal: "male",
    demo_seed: preset.seed_id,
    sections: [
      {
        id: `${preset.preset_id}-section-1`,
        type: sectionType,
        lyrics: `Demo seed ${preset.seed_id} — ${preset.title}`,
        voice_id: preset.voice_id,
      },
    ],
    structure: [`${preset.preset_id}-section-1`],
  };
}

async function ensureDemoUser(seedId) {
  const email = `demo-seed-${seedId}@neo-fm.demo`;
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw new Error(`auth.admin.listUsers: ${listErr.message}`);
  const found = list.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data: created, error: createErr } =
    await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { demo_seed: seedId, source: "seed-discover" },
    });
  if (createErr) {
    throw new Error(`auth.admin.createUser(${email}): ${createErr.message}`);
  }
  return created.user.id;
}

async function findExistingJob(userId, seedId) {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, song_documents!inner(document_json)")
    .eq("user_id", userId)
    .eq("song_documents.document_json->demo_seed", seedId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`select jobs (seed=${seedId}): ${error.message}`);
  }
  return data ? data.id : null;
}

async function insertSongDocument(userId, preset) {
  const doc = buildSongDocument(preset);
  const { data, error } = await supabase
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
  if (error) throw new Error(`insert song_documents: ${error.message}`);
  return data.id;
}

async function insertJob(userId, songDocId, preset) {
  const audio = audioManifest[String(preset.seed_id)] ?? null;
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      song_document_id: songDocId,
      status: "completed",
      progress: 100,
      audio_url: audio?.audio_url ?? null,
      duration_seconds: audio?.duration_seconds ?? 60,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert jobs: ${error.message}`);
  return data.id;
}

async function publishJob(jobId) {
  const { data, error } = await supabase.rpc("publish_song", {
    p_job_id: jobId,
    p_visibility: "public",
  });
  if (error) throw new Error(`publish_song(${jobId}): ${error.message}`);
  return data;
}

if (RESET) {
  log("RESET: deleting prior demo-seed rows");
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    console.error(`auth.admin.listUsers (reset): ${listErr.message}`);
    process.exit(3);
  }
  for (const u of list.users) {
    if (!u.email?.startsWith("demo-seed-")) continue;
    if (!u.email.endsWith("@neo-fm.demo")) continue;
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) {
      log(`WARN: deleteUser ${u.email}: ${error.message}`);
    } else {
      log(`reset: removed ${u.email}`);
    }
  }
}

const results = [];
for (const preset of PRESETS) {
  try {
    const userId = await ensureDemoUser(preset.seed_id);
    const existing = await findExistingJob(userId, preset.seed_id);
    let jobId = existing;
    if (!existing) {
      const docId = await insertSongDocument(userId, preset);
      jobId = await insertJob(userId, docId, preset);
    }
    const published = await publishJob(jobId);
    results.push({
      seed_id: preset.seed_id,
      preset_id: preset.preset_id,
      user_id: userId,
      job_id: jobId,
      reused: Boolean(existing),
      published,
    });
    log(
      `seed ${preset.seed_id} -> job ${jobId} (${existing ? "reused" : "new"}, published)`,
    );
  } catch (err) {
    log(`ERROR seed ${preset.seed_id}: ${err}`);
    results.push({
      seed_id: preset.seed_id,
      preset_id: preset.preset_id,
      error: String(err),
    });
  }
}

const applyManifest = {
  apply: true,
  reset: RESET,
  audio_manifest: AUDIO_MANIFEST_PATH ?? null,
  generated_at: new Date().toISOString(),
  preset_count: PRESETS.length,
  results,
};
const APPLY_OUT = path.join(OUT_DIR, "seed-apply-manifest.json");
fs.writeFileSync(APPLY_OUT, `${JSON.stringify(applyManifest, null, 2)}\n`);
log(`wrote apply manifest -> ${APPLY_OUT}`);

const failed = results.filter((r) => r.error);
if (failed.length) {
  log(`${failed.length}/${results.length} seeds failed`);
  process.exit(1);
}
log(`OK: seeded ${results.length}/${PRESETS.length} demo songs`);
