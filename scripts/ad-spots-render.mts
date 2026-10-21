/**
 * Renders spoken house-ad spots (the headline of each active house slot, read once by the AI host voice) with Gemini TTS.
 * Paid: one TTS request per slot. Audio plays only when ADS_AUDIO_ENABLED=1 (lib/station/ads.ts).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/ad-spots-render.mts --slots slots.json --reserved 12 [--out /tmp/ad-spots]
 *
 * slots.json is a list of { id, headline } for the active house slots with no audio_path (read them from ad_slots).
 * Without --reserved it only prints the plan (no spend). The caller first reserves the requests with
 * reserve_provider_call('tts','batch',...) (apps/web/lib/ops/provider-cap.ts) and passes the count as --reserved; the script never
 * makes more calls than that. It writes <out>/<slot id>.mp3 and <out>/manifest.json ([{ slot_id, file, duration_seconds }]); it has no
 * database access. Attach each file with POST /api/admin/ad-spots (multipart: file, slot_id, duration_seconds, ai_made=true).
 * Needs ffmpeg and ffprobe. Spots are 5 to 30 s (ad_slots check); a headline is about 4 to 8 s spoken. Safe to re-run: existing mp3s are skipped.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireWeb = createRequire(join(process.cwd(), "apps/web/package.json"));
const { GoogleGenAI } = requireWeb("@google/genai") as typeof import("@google/genai");

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const reserved = Number(arg("reserved", "0"));
const out = arg("out", "/tmp/ad-spots") as string;
const VOICE = "Kore";

const slotsFile = arg("slots");
if (!slotsFile) throw new Error("need --slots slots.json (a list of { id, headline })");
const todo = JSON.parse(readFileSync(slotsFile, "utf8")) as { id: string; headline: string }[];
console.log(`${todo.length} slots to render`);
for (const s of todo) console.log(`  ${s.id} ${s.headline}`);
if (!(reserved > 0)) { console.log("plan only: pass --reserved N (requests already reserved through the provider cap) to render"); process.exit(0); }

const gkey = process.env.GEMINI_API_KEY;
if (!gkey) throw new Error("need GEMINI_API_KEY");
const client = new GoogleGenAI({ apiKey: gkey });
mkdirSync(out, { recursive: true });
let used = 0;
const manifestPath = join(out, "manifest.json");
const manifest: { slot_id: string; file: string; duration_seconds: number }[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];

for (const s of todo) {
  const mp3Path = join(out, `${s.id}.mp3`);
  if (existsSync(mp3Path)) continue;
  if (used >= reserved) { console.log(`reserved ${reserved} requests spent; stopping`); break; }
  used++;
  // Tier 1 allows 10 TTS requests a minute; pace the calls instead of burning reserved requests on 429s.
  await new Promise((r) => setTimeout(r, 7000));
  const i = await client.interactions.create({
    model: "gemini-3.8-flash-tts",
    input: [{ type: "user_input", content: [{ type: "text", text: s.headline }] }],
    response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
    generation_config: { speech_config: [{ voice: VOICE }] },
    store: false,
  }, { maxRetries: 0 });
  const b64 = i.output_audio?.data;
  if (!b64) { console.log(`no audio for ${s.id}`); continue; }
  const wav = join(out, `${s.id}.wav`);
  const mp3 = join(out, `${s.id}.mp3`);
  writeFileSync(wav, Buffer.from(b64, "base64"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "24000", "-b:a", "48k", mp3]);
  const probe = () => Math.ceil(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString().trim()));
  let seconds = probe();
  if (seconds < 5) {
    // The table needs at least 5 s; pad a short headline with silence rather than lose the TTS request already spent.
    const padded = join(out, `${s.id}.pad.mp3`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-af", "apad=whole_dur=5", "-ac", "1", "-ar", "24000", "-b:a", "48k", padded]);
    renameSync(padded, mp3);
    seconds = probe();
  }
  if (seconds < 5 || seconds > 30) { console.log(`skip ${s.id}: ${seconds}s is outside the 5 to 30 s the table allows`); continue; }
  console.log(`rendered ${s.id}: ${seconds}s`);
  manifest.push({ slot_id: s.id, file: mp3, duration_seconds: seconds });
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`TTS requests used: ${used}`);
