#!/usr/bin/env node
/**
 * Builds the station's spoken segments from a media-lab TTS run (lab/av-p0): converts each WAV to a small loudness-normalised
 * mono MP3 under apps/web/public/voice/ and writes the line index apps/web/lib/station/voice-lines.json.
 *
 *   node scripts/voice-lines-build.mjs [/mnt/project-files/lab/av-p0]
 *
 * Needs ffmpeg. Safe to re-run: it rebuilds the index from the lab manifest and only converts files that are missing.
 * No model call and no spend; the audio was already paid for in the lab. Every line is an AI host (ai_label) and
 * non-English lines are pending native-speaker review (native_review in the lab manifest).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const labDir = process.argv[2] ?? "/mnt/project-files/lab/av-p0";
const outDir = join(root, "apps/web/public/voice");
const KINDS = new Set(["host-link", "ident-daypart", "time-check", "ident-station"]);

const manifest = JSON.parse(readFileSync(join(labDir, "manifest.json"), "utf8"));
const lines = [];
for (const [id, m] of Object.entries(manifest)) {
  if (!KINDS.has(m.kind) || !m.ai_label || m.native_review === "rejected") continue;
  const wav = join(labDir, m.file);
  const mp3 = join(outDir, `${id}.mp3`);
  if (!existsSync(wav)) continue;
  if (!existsSync(mp3)) {
    mkdirSync(dirname(mp3), { recursive: true });
    // -16 LUFS keeps speech level with the music; 32 kbps mono is plenty for a 24 kHz voice and keeps the repo small.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "24000", "-b:a", "32k", mp3]);
  }
  const hour = m.kind === "time-check" ? Number(m.daypart) : undefined;
  lines.push({
    id, kind: m.kind, lang: m.lang,
    ...(m.kind === "host-link" || m.kind === "ident-daypart" ? { daypart: m.daypart } : {}),
    ...(hour !== undefined ? { hour } : {}),
    seconds: Math.round(m.seconds * 10) / 10, text: m.text,
  });
}
lines.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(root, "apps/web/lib/station/voice-lines.json"), `${JSON.stringify(lines, null, 1)}\n`);
console.log(`${lines.length} lines indexed`);
