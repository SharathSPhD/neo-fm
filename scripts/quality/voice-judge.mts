/**
 * Voice-profile judge: for each sung clip, Gemini reports who is singing (lead gender, register, timbre, singer count)
 * and how native the delivery sounds in the target language (1-5, accent origin). Used to measure voice diversity and
 * nativeness across the pool; machine judgment only, not a native-speaker panel. One audio call per file, no Lyria.
 *   GEMINI_API_KEY=... npx tsx scripts/quality/voice-judge.mts <meta.json> <audio_dir> <out.json>
 * meta.json maps id -> { language, title }; audio files are <audio_dir>/<id>.mp3.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { geminiInteract, geminiQaModel } from "../../apps/web/lib/gemini/interactions";

const [metaPath, dir, out] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY!;
const NAMES: Record<string, string> = {
  hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada", bn: "Bengali", mr: "Marathi", gu: "Gujarati", pa: "Punjabi", ml: "Malayalam", en: "English",
};
const meta = JSON.parse(readFileSync(metaPath!, "utf8")) as Record<string, { language: string }>;
const done: Record<string, unknown> = existsSync(out!) ? JSON.parse(readFileSync(out!, "utf8")) : {};
const ids = Object.keys(meta).filter((id) => !(id in done));

async function judge(id: string) {
  const lang = NAMES[meta[id]!.language] ?? meta[id]!.language;
  const r = await geminiInteract({
    apiKey: key, model: geminiQaModel(), json: true,
    text: `You are a native ${lang} speaker and a vocal analyst. Listen to this AI-generated sung ${lang} track and describe the singing voice. Reply as JSON: {"lead_gender":"male"|"female"|"mixed"|"child"|"unclear","register":"low"|"mid"|"high","timbre":one of "warm","bright","breathy","husky","nasal","powerful","soft","raspy","airy","classical-trained","folk","other","singers":number,"nativeness":1-5 (5 = indistinguishable from a native ${lang} singer, 1 = clearly foreign accent),"accent_note":string (the accent you hear, e.g. "Hindi-influenced", "neutral Mumbai Marathi", "English-influenced"),"ai_sounding":1-5 (5 = obviously synthetic)}. Be critical; use the full scale.`,
    audio: { data: readFileSync(`${dir}/${id}.mp3`), mimeType: "audio/mpeg" },
  });
  return JSON.parse(r.text) as Record<string, unknown>;
}

for (let i = 0; i < ids.length; i += 4) {
  await Promise.all(ids.slice(i, i + 4).map(async (id) => {
    try { done[id] = { language: meta[id]!.language, ...(await judge(id)) }; }
    catch (e) { done[id] = { language: meta[id]!.language, error: e instanceof Error ? e.message.slice(0, 80) : "failed" }; }
  }));
  writeFileSync(out!, JSON.stringify(done, null, 1));
}
console.log("judged", Object.keys(done).length);
