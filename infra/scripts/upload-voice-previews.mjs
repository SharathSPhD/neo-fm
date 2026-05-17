#!/usr/bin/env node
// upload-voice-previews.mjs
//
// Companion to services/vocal-synth/scripts/render_voice_previews.py.
//
// The Python script renders the 16 voice-preview WAVs into a local
// directory (deterministic FakeVocalModel output, suitable for the
// non-DGX operator path). This script uploads them to the public
// `voice-samples` Supabase Storage bucket under `samples/<voice_id>.wav`
// using the @supabase/supabase-js client, which handles both the
// legacy JWT and the new-style sb_secret_* service-role keys.
//
// Usage:
//   SUPABASE_URL=...                                                \
//   SUPABASE_SERVICE_ROLE_KEY=...                                   \
//     node infra/scripts/upload-voice-previews.mjs --dir /tmp/voice-previews
//
// Idempotent: uploads are upsert: true, so re-running overwrites
// existing objects. Skips files whose name doesn't end in .wav.

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { createClient } from "@supabase/supabase-js";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(2);
  }
  return v;
}

function parseArgs(argv) {
  let dir = "/tmp/voice-previews";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") dir = argv[++i];
  }
  return { dir };
}

async function main() {
  const { dir } = parseArgs(process.argv);
  const supabase = createClient(
    need("SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const files = (await readdir(dir))
    .filter((f) => extname(f).toLowerCase() === ".wav")
    .sort();
  if (files.length === 0) {
    console.error(`no .wav files in ${dir}`);
    process.exit(2);
  }

  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const voice_id = f.replace(/\.wav$/i, "");
    const path = `samples/${voice_id}.wav`;
    const body = await readFile(join(dir, f));
    const { error } = await supabase.storage
      .from("voice-samples")
      .upload(path, body, {
        contentType: "audio/wav",
        upsert: true,
      });
    if (error) {
      console.error(`  FAIL  voice-samples/${path}: ${error.message}`);
      fail += 1;
    } else {
      console.log(`  ok    voice-samples/${path}`);
      ok += 1;
    }
  }
  console.log(`uploaded ${ok}/${ok + fail} voice previews`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
