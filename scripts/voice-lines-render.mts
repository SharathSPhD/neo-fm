/**
 * Renders station spoken segments (AI host idents and links) with Gemini TTS into the media-lab layout that
 * scripts/voice-lines-build.mjs then converts and indexes. Paid: one TTS request per line.
 *
 *   GEMINI_API_KEY=... npx tsx scripts/voice-lines-render.mts --langs te,bn,kn --reserved 72 [--lab /mnt/project-files/lab/av-p0]
 *
 * Provider cap: this script has no database access, so the caller first reserves the requests with
 * reserve_provider_call('tts','batch',...) (apps/web/lib/ops/provider-cap.ts) and passes the count as --reserved.
 * The script never makes more calls than --reserved. Kannada has no host scripts in scripts.json, so scripts-kn.json
 * (drafted by Gemini text from the Hindi set) is used; it is machine copy, scored by Gemini rather than read by a native speaker.
 * Per daypart it takes the first --per (default 2) idents and host links. Safe to re-run: existing WAVs are skipped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// @google/genai is an apps/web dependency; resolve it from there.
const { GoogleGenAI } = createRequire(join(process.cwd(), "apps/web/package.json"))("@google/genai") as typeof import("@google/genai");

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const langs = (arg("langs", "te,bn,kn") as string).split(",");
const reserved = Number(arg("reserved", "0"));
const lab = arg("lab", "/mnt/project-files/lab/av-p0") as string;
const DAYPARTS = ["dawn", "morning", "midday", "evening", "dusk", "night"] as const;
const PER = Number(arg("per", "2"));
const VOICE = "Kore";
const key = process.env.GEMINI_API_KEY;
if (!key || !(reserved > 0)) throw new Error("need GEMINI_API_KEY and --reserved N (requests already reserved through the provider cap)");

type Script = { daypart: Record<string, string[]>; host: Record<string, string[]> };
const scripts = JSON.parse(readFileSync(join(lab, "scripts.json"), "utf8")) as Record<string, Script>;
const knPath = join(lab, "scripts-kn.json");
const manifestPath = join(lab, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, Record<string, unknown>>;
const client = new GoogleGenAI({ apiKey: key });
let used = 0;

if (langs.includes("kn") && !existsSync(knPath)) {
  // Text only (not a TTS request): draft Kannada lines from the Hindi set, same meaning and length.
  const hi = scripts.hi!;
  const src = { daypart: Object.fromEntries(DAYPARTS.map((d) => [d, hi.daypart[d]!.slice(0, PER)])), host: Object.fromEntries(DAYPARTS.map((d) => [d, hi.host[d]!.slice(0, PER)])) };
  const r = await client.interactions.create({
    model: "gemini-3.8-flash",
    input: `Rewrite these Hindi radio-host lines as natural spoken Kannada in Kannada script, same meaning and length, for an AI radio host on neo-fm. Keep "neo-fm" in Latin letters. Each line must make clear the host is an AI. No song names, no claims about people. Reply as JSON with the same shape: ${JSON.stringify(src)}`,
    response_format: { type: "text", mime_type: "application/json" },
    store: false,
  }, { maxRetries: 0 });
  writeFileSync(knPath, JSON.stringify(JSON.parse(r.output_text ?? "{}"), null, 1));
}

async function tts(text: string, wav: string): Promise<number | null> {
  if (existsSync(wav)) return null;
  if (used >= reserved) throw new Error(`reserved ${reserved} requests spent`);
  used++;
  // Tier 1 allows 10 TTS requests a minute; pace the calls instead of burning reserved requests on 429s.
  await new Promise((r) => setTimeout(r, 7000));
  const i = await client.interactions.create({
    model: "gemini-3.8-flash-tts",
    input: [{ type: "user_input", content: [{ type: "text", text }] }],
    response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
    generation_config: { speech_config: [{ voice: VOICE }] },
    store: false,
  }, { maxRetries: 0 });
  const b64 = i.output_audio?.data;
  if (!b64) throw new Error("no audio returned");
  const buf = Buffer.from(b64, "base64");
  mkdirSync(dirname(wav), { recursive: true });
  writeFileSync(wav, buf);
  return (buf.length - 44) / 48000;
}

for (const lang of langs) {
  const s: Script = lang === "kn" ? JSON.parse(readFileSync(knPath, "utf8")) : scripts[lang]!;
  for (const [kind, key2] of [["ident-daypart", "daypart"], ["host-link", "host"]] as const) {
    for (const d of DAYPARTS) {
      const lines = (s[key2][d] ?? []).slice(0, PER);
      for (let n = 0; n < lines.length; n++) {
        const id = `${kind}/${lang}-${d}-${n + 1}`;
        const file = `audio/${id}.wav`;
        const secs = await tts(lines[n]!, join(lab, file));
        if (secs !== null || !manifest[id]) {
          manifest[id] = { file, kind, lang, daypart: d, voice: VOICE, text: lines[n], seconds: Math.round((secs ?? 0) * 100) / 100, ai_label: true, native_review: "pending" };
          writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
        }
      }
    }
  }
}
process.on("exit", () => console.log(`TTS requests attempted: ${used}`));
console.log(`rendered with ${used} of ${reserved} reserved TTS requests`);
