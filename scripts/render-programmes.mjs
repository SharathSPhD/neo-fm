#!/usr/bin/env node
/**
 * Renders the spoken programmes in apps/web/lib/station/voice-programmes.json that are not rendered yet: Gemini 3.8 Flash TTS
 * (voice Kore, like the host links) -> loudness-normalised 32 kbps mono mp3 under apps/web/public/voice/programme/, then marks
 * the line rendered with its duration. Safe to re-run: rendered lines and existing wavs are skipped, and it stops at the first
 * rate-limit error (Tier 1 allows 100 TTS requests a day) after keeping what it already made.
 *
 *   GEMINI_API_KEY=... node scripts/render-programmes.mjs [--langs hi,kn] [--reserved N] [wavDir]
 *
 * --langs limits the run to those languages. --reserved N caps the TTS requests made (reserve them through the provider cap first,
 * apps/web/lib/ops/provider-cap.ts); without it the run is unlimited. Calls are paced for Tier 1's 10 TTS requests a minute.
 *
 * Needs ffmpeg. Spends Gemini TTS (about USD 0.007 per line): only run it with S's approval, and add the spend to lab/spend.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web");
const { GoogleGenAI } = createRequire(join(web, "package.json"))("@google/genai");
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const langs = arg("langs")?.split(",");
const reserved = arg("reserved") === undefined ? Infinity : Number(arg("reserved"));
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--")));
const wavDir = resolve(positional[0] ?? join(process.env.TMPDIR ?? "/tmp", "programme-wavs"));
const file = join(web, "lib/station/voice-programmes.json");
const lines = JSON.parse(readFileSync(file, "utf8"));
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
mkdirSync(wavDir, { recursive: true });

let made = 0, calls = 0;
for (const l of lines) {
  if (l.rendered || (langs && !langs.includes(l.lang))) continue;
  const wav = join(wavDir, `${l.id.split("/")[1]}.wav`);
  if (!existsSync(wav)) {
    if (calls >= reserved) { console.error(`reserved ${reserved} calls used up at ${l.id}`); break; }
    if (calls > 0) await new Promise((r) => setTimeout(r, 6500));
    calls++;
    try {
      const i = await client.interactions.create({
        model: "gemini-3.8-flash-tts",
        input: [{ type: "user_input", content: [{ type: "text", text: l.text, annotations: [{ type: "speech_metadata", style: "warm, calm FM radio host, unhurried" }] }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: "Kore" }] },
        store: false,
      }, { maxRetries: 0 });
      writeFileSync(wav, Buffer.from(i.output_audio.data, "base64"));
    } catch (e) {
      console.error(`stopped at ${l.id}: ${e?.message ?? e}`);
      break;
    }
  }
  const mp3 = join(web, "public/voice", `${l.id}.mp3`);
  mkdirSync(dirname(mp3), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "24000", "-b:a", "32k", mp3]);
  const sec = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString());
  l.seconds = Math.round(sec * 10) / 10;
  l.rendered = true;
  made++;
  console.log(l.id, l.seconds);
}
writeFileSync(file, `${JSON.stringify(lines, null, 1)}\n`);
console.log(`${made} rendered, ${lines.filter((l) => !l.rendered).length} pending`);
