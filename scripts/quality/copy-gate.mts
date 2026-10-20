/**
 * Gemini copy gate (replaces the human native read, #166): for each UI locale, Gemini reviews every string against the
 * English source as a native speaker would and scores accuracy and naturalness 1-5, flagging placeholders that changed.
 * Machine judgment only, no native-speaker panel. Pass bar: locale mean >= 4.0 and no key below 3.
 *   GEMINI_API_KEY=... npx tsx scripts/quality/copy-gate.mts <out.json> hi bn ta te kn
 * Resumable: keys already in <out.json> are skipped. Prints a per-locale summary and the flagged keys.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { geminiInteract, geminiQaModel } from "../../apps/web/lib/gemini/interactions";
import { en } from "../../apps/web/lib/i18n/locales/en";
import { hi } from "../../apps/web/lib/i18n/locales/hi";
import { bn } from "../../apps/web/lib/i18n/locales/bn";
import { ta } from "../../apps/web/lib/i18n/locales/ta";
import { te } from "../../apps/web/lib/i18n/locales/te";
import { kn } from "../../apps/web/lib/i18n/locales/kn";

const [out, ...langs] = process.argv.slice(2);
const key = process.env.GEMINI_API_KEY!;
const LOCALES: Record<string, { name: string; dict: Record<string, string> }> = {
  hi: { name: "Hindi", dict: hi }, bn: { name: "Bengali", dict: bn }, ta: { name: "Tamil", dict: ta },
  te: { name: "Telugu", dict: te }, kn: { name: "Kannada", dict: kn },
};
const source = en as Record<string, string>;
const done: Record<string, Record<string, { score: number; note?: string; fix?: string }>> = existsSync(out!) ? JSON.parse(readFileSync(out!, "utf8")) : {};
const placeholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort().join(",");

async function review(lang: string, keys: string[]) {
  const { name, dict } = LOCALES[lang]!;
  const items = keys.map((k) => ({ key: k, en: source[k], text: dict[k] }));
  const r = await geminiInteract({
    apiKey: key, model: geminiQaModel(), json: true,
    text: `You are a native ${name} speaker and a professional UI copy editor for a music app. For each item compare the ${name} text with the English source. Score 1-5: 5 = accurate and natural, as a native product would write it; 3 = understandable but stiff, partly wrong or unnatural; 1 = wrong or unintelligible. Be critical and use the full scale. Reply as JSON: {"results":[{"key":string,"score":1-5,"note":string (only if score < 5, one short English sentence),"fix":string (only if score <= 3, a better ${name} version keeping any {placeholders})}]}. Items: ${JSON.stringify(items)}`,
  });
  return (JSON.parse(r.text) as { results: { key: string; score: number; note?: string; fix?: string }[] }).results;
}

for (const lang of langs) {
  if (!LOCALES[lang]) { console.log("skip", lang); continue; }
  const { dict } = LOCALES[lang];
  done[lang] ??= {};
  const todo = Object.keys(source).filter((k) => k in dict && !(k in done[lang]!));
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    try {
      for (const row of await review(lang, batch)) if (batch.includes(row.key)) done[lang]![row.key] = { score: row.score, note: row.note, fix: row.fix };
    } catch (e) { console.log(lang, "batch failed", e instanceof Error ? e.message.slice(0, 80) : e); }
    writeFileSync(out!, JSON.stringify(done, null, 1));
  }
  const rows = Object.entries(done[lang]!);
  const mean = rows.reduce((a, [, v]) => a + v.score, 0) / Math.max(1, rows.length);
  const low = rows.filter(([, v]) => v.score < 3).map(([k]) => k);
  const broken = Object.keys(done[lang]!).filter((k) => placeholders(source[k] ?? "") !== placeholders(dict[k] ?? ""));
  console.log(`${lang}: ${rows.length}/${Object.keys(dict).length} reviewed, mean ${mean.toFixed(2)}, below 3: ${low.length}, placeholder mismatch: ${broken.length}, ${mean >= 4 && !low.length && !broken.length ? "PASS" : "REVIEW"}`);
  if (low.length) console.log("  low:", low.slice(0, 20).join(", "));
}
