/**
 * Renders spoken house-ad spots (the headline of each active house slot, read once by the AI host voice) with Gemini TTS.
 * Paid: one TTS request per slot without audio. Audio plays only when ADS_AUDIO_ENABLED=1 (lib/station/ads.ts).
 *
 *   plan:   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ad-spots-render.mts
 *   render: GEMINI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ad-spots-render.mts --reserved 12 [--apply]
 *
 * Without --reserved it only prints the slots it would render (no spend, no writes). The caller first reserves the requests with
 * reserve_provider_call('tts','batch',...) and passes the count as --reserved; the script never makes more calls than that.
 * Without --apply it renders to --out and writes nothing to Supabase. With --apply it uploads ads/<slot id>.mp3 to the tracks
 * bucket and sets audio_path, duration_seconds and ai_made=true on the slot. Safe to re-run: slots that already have audio are skipped.
 * Needs ffmpeg and ffprobe. Spots are 5 to 30 s (ad_slots check); a headline is about 4 to 8 s spoken.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireWeb = createRequire(join(process.cwd(), "apps/web/package.json"));
const { GoogleGenAI } = requireWeb("@google/genai") as typeof import("@google/genai");
const { createClient } = requireWeb("@supabase/supabase-js") as typeof import("@supabase/supabase-js");

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const reserved = Number(arg("reserved", "0"));
const apply = process.argv.includes("--apply");
const out = arg("out", "/tmp/ad-spots") as string;
const VOICE = "Kore";

const url = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !sbKey) throw new Error("need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(url, sbKey, { auth: { persistSession: false } });

const { data: slots, error } = await db.from("ad_slots").select("id,headline,languages,audio_path").eq("kind", "house").eq("active", true);
if (error) throw error;
const todo = (slots ?? []).filter((s) => !s.audio_path);
console.log(`${todo.length} active house slots without audio`);
for (const s of todo) console.log(`  ${s.id} [${(s.languages ?? []).join(",")}] ${s.headline}`);
if (!(reserved > 0)) { console.log("plan only: pass --reserved N (requests already reserved through the provider cap) to render"); process.exit(0); }

const gkey = process.env.GEMINI_API_KEY;
if (!gkey) throw new Error("need GEMINI_API_KEY");
const client = new GoogleGenAI({ apiKey: gkey });
mkdirSync(out, { recursive: true });
let used = 0;

for (const s of todo) {
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
  const seconds = Math.ceil(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString().trim()));
  if (seconds < 5 || seconds > 30) { console.log(`skip ${s.id}: ${seconds}s is outside the 5 to 30 s the table allows`); continue; }
  console.log(`rendered ${s.id}: ${seconds}s`);
  if (!apply) continue;
  const path = `ads/${s.id}.mp3`;
  const up = await db.storage.from("tracks").upload(path, readFileSync(mp3), { contentType: "audio/mpeg", upsert: true });
  if (up.error) { console.log(`upload failed for ${s.id}: ${up.error.message}`); continue; }
  const upd = await db.from("ad_slots").update({ audio_path: path, duration_seconds: seconds, ai_made: true }).eq("id", s.id);
  console.log(upd.error ? `update failed for ${s.id}: ${upd.error.message}` : `applied ${s.id}`);
}
console.log(`TTS requests used: ${used}`);
