/**
 * Blind Gemini audio judge: rates each sung clip 1-5 on pronunciation naturalness, stress/rhythm fit, vocal clarity and overall,
 * given only the language (no id, no score, shuffled order). Cost: one audio call per file (~1-2k tokens), no Lyria.
 *   GEMINI_API_KEY=... npx tsx scripts/quality/blind-judge.mts <audio_dir> <out.json>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { geminiInteract, geminiQaModel } from "../../apps/web/lib/gemini/interactions";

const [dir, out] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY!;
const LANG: Record<string, string> = { bn: "Bengali", hi: "Hindi", kn: "Kannada", ta: "Tamil", te: "Telugu" };
const files = readdirSync(dir!).filter((f) => /\.(mp3|wav)$/.test(f));
// deterministic shuffle so the order carries no language grouping
const order = files.map((f, i) => ({ f, k: Math.sin(i * 9301 + 49297) })).sort((a, b) => a.k - b.k).map((x) => x.f);
const rows: unknown[] = [];
for (const f of order) {
  const lang = LANG[f.slice(0, 2)]!;
  const audio = readFileSync(`${dir}/${f}`);
  try {
    const r = await geminiInteract({
      apiKey: key, model: geminiQaModel(), json: true,
      text: `You are a strict native-level listener of ${lang} songs. Rate this AI-generated sung ${lang} track from 1 (poor) to 5 (excellent, indistinguishable from a native singer) on: pronunciation (natural ${lang} phonemes and vowel length), stress_rhythm (syllable stress and word boundaries fit the melody), clarity (words intelligible), overall. Be critical; use the full scale. Reply as JSON {"pronunciation":n,"stress_rhythm":n,"clarity":n,"overall":n,"worst_issue":string}.`,
      audio: { data: audio, mimeType: f.endsWith(".wav") ? "audio/wav" : "audio/mpeg" },
    });
    try { rows.push({ file: f, language: lang, ...JSON.parse(r.text || "{}") }); }
    catch { rows.push({ file: f, error: "unparseable" }); }
  } catch (e) { rows.push({ file: f, error: e instanceof Error ? e.message.slice(0, 80) : "failed" }); }
}
writeFileSync(out!, JSON.stringify(rows, null, 1));
const by: Record<string, number[]> = {};
for (const r of rows as { language?: string; overall?: number }[]) if (r.language && typeof r.overall === "number") (by[r.language] ??= []).push(r.overall);
for (const [l, xs] of Object.entries(by)) console.log(l, "n", xs.length, "mean overall", (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2));
