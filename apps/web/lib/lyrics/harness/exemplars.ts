import data from "./data/exemplars.json";

export interface Exemplar { id: string; lang: string; style: string; brief: string; text: string; judge: number }

const EXEMPLARS = data as Exemplar[];
const NAME_TO_CODE: Record<string, string> = { kannada: "kn", tamil: "ta", telugu: "te", hindi: "hi", bengali: "bn", marathi: "mr", punjabi: "pa", gujarati: "gu", malayalam: "ml" };

export const langCode = (language: string): string => NAME_TO_CODE[language.toLowerCase()] ?? language.toLowerCase();
const toks = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);
const grams = (s: string): Set<string> => {
  const t = s.replace(/[\s\[\]\d॥।,.;:!?'"()-]+/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 5 <= t.length; i++) out.add(t.slice(i, i + 5));
  return out;
};

/** Share of a draft's 5-character grams that also occur in the text: the guard that keeps exemplars from being echoed back. */
export function overlapRatio(draft: string, other: string): number {
  const d = grams(draft);
  if (d.size === 0) return 0;
  const o = grams(other);
  let hit = 0;
  for (const g of d) if (o.has(g)) hit++;
  return hit / d.size;
}

/**
 * Judge-picked exemplars for one brief: same language only, ranked by style match, brief word overlap and judge score.
 * Returns [] for a language with no exemplars (the harness then simply runs without that block).
 */
export function retrieveExemplars(q: { language: string; style: string; brief: string }, k: number, pool: Exemplar[] = EXEMPLARS): Exemplar[] {
  const code = langCode(q.language);
  const bt = toks(q.brief);
  const fam = q.style.split("-")[0] ?? "";
  const scored = pool.filter((e) => e.lang === code).map((e) => {
    const et = toks(e.brief);
    let shared = 0;
    for (const t of et) if (bt.has(t)) shared++;
    const jac = shared / Math.max(1, new Set([...bt, ...et]).size);
    const styleScore = e.style === q.style ? 1 : fam && e.style.startsWith(fam) ? 0.5 : 0;
    return { e, s: styleScore + 2 * jac + 0.25 * (e.judge - 3) };
  });
  scored.sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id));
  return scored.slice(0, Math.max(0, k)).map((x) => x.e);
}

export function exemplarBlock(ex: Exemplar[]): string {
  if (ex.length === 0) return "";
  return `QUALITY REFERENCES (strong lyrics written for other briefs in this language; study their diction, image choice and line craft; never reuse their lines, images or rhyme words):\n${ex.map((e, i) => `[${i + 1}]\n${e.text}`).join("\n\n")}`;
}
