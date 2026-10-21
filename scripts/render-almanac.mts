/**
 * Renders almanac festival countdowns (apps/web/lib/station/almanac.ts) with Gemini TTS: voice Kore like the host links ->
 * loudness-normalised 32 kbps mono mp3 under apps/web/public/voice/almanac/, then records the duration in voice-almanac.json.
 * Safe to re-run: lines already in the JSON are skipped, and it stops at the first error keeping what it made.
 *
 *   GEMINI_API_KEY=... npx tsx scripts/render-almanac.mts --festivals dhanteras,diwali,bhai-dooj --langs hi,ta,te,kn,bn --reserved 60 [wavDir]
 *
 * Paid: one TTS request per line (about USD 0.002 each; Tier 1 allows 100 TTS requests a day). The caller first reserves the
 * requests through the provider cap and passes the count as --reserved; the script never makes more calls than that.
 * Needs ffmpeg. Add the spend to lab/spend.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { allAlmanacLines } from "../apps/web/lib/station/almanac";

const web = join(process.cwd(), "apps/web");
const { GoogleGenAI } = createRequire(join(web, "package.json"))("@google/genai") as typeof import("@google/genai");
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const festivals = arg("festivals")?.split(",");
const langs = arg("langs")?.split(",");
const reserved = Number(arg("reserved") ?? 0);
const key = process.env.GEMINI_API_KEY;
if (!key || !(reserved > 0)) throw new Error("need GEMINI_API_KEY and --reserved N (requests already reserved through the provider cap)");
const wavDir = resolve(process.argv.filter((a, i) => i > 1 && !a.startsWith("--") && !process.argv[i - 1]!.startsWith("--"))[0] ?? join(process.env.TMPDIR ?? "/tmp", "almanac-wavs"));
mkdirSync(wavDir, { recursive: true });

const file = join(web, "lib/station/voice-almanac.json");
const done = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
const client = new GoogleGenAI({ apiKey: key });
const todo = allAlmanacLines().filter((l) => !done[l.id] && (!festivals || festivals.includes(l.festival)) && (!langs || langs.includes(l.lang)));

let calls = 0, made = 0;
for (const l of todo) {
  const wav = join(wavDir, `${l.id.split("/")[1]}.wav`);
  if (!existsSync(wav)) {
    if (calls >= reserved) { console.error(`reserved ${reserved} calls used up at ${l.id}`); break; }
    // Tier 1 allows 10 TTS requests a minute: pace the calls instead of failing on the 429.
    if (calls > 0) await new Promise((r) => setTimeout(r, 6500));
    calls++;
    try {
      const i = await client.interactions.create({
        model: "gemini-3.8-flash-tts",
        input: [{ type: "user_input", content: [{ type: "text", text: l.text, annotations: [{ type: "speech_metadata", style: "warm, calm FM radio host, unhurried" }] }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: "Kore" }] },
        store: false,
      } as never, { maxRetries: 0 }) as unknown as { output_audio: { data: string } };
      writeFileSync(wav, Buffer.from(i.output_audio.data, "base64"));
    } catch (e) {
      console.error(`stopped at ${l.id}: ${(e as Error)?.message ?? e}`);
      break;
    }
  }
  const mp3 = join(web, "public/voice", `${l.id}.mp3`);
  mkdirSync(dirname(mp3), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "24000", "-b:a", "32k", mp3]);
  const sec = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString());
  done[l.id] = Math.round(sec * 10) / 10;
  made++;
  console.log(l.id, done[l.id]);
}
writeFileSync(file, `${JSON.stringify(done, null, 1)}\n`);
console.log(`${made} rendered, ${todo.length - made} pending of this selection`);
