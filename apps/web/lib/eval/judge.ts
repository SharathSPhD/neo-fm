import type Anthropic from "@anthropic-ai/sdk";

export const JUDGE_MODEL = "claude-sonnet-5-5";
export const BASELINE_MODEL = "claude-haiku-5-5";

const DIMS = ["prosody", "diction", "imagery", "cultural", "originality"] as const;
export type Dim = (typeof DIMS)[number];
export const STRUCTURE_TARGET = "This is a 30-second song: about 8 short lines in total (a 2-line hook plus two 2-line verses), roughly 40-70 words. Do not write more.";

const RUBRIC = `You are a senior lyricist and native-level editor in the target language. Two lyrics were written for the same brief and the same 30-second structure.
First write a brief reason, then score each lyric 1-5 (integers; 3 = competent, 5 = outstanding) on:
- prosody: singable meter, consistent line lengths, natural stresses, internal rhyme/prasa where the style expects it
- diction: native, idiomatic register right for the style (not translated-sounding), correct spelling in native script
- imagery: fresh, specific imagery without stock film-lyric cliches
- cultural: faithful to the culture, season, ritual and emotion the brief names
- originality: avoids stock phrases and formulaic rhymes
Judge quality, not length. You do not know how either was made.
Reply with ONLY JSON: {"reason":"<=50 words","A":{"prosody":n,"diction":n,"imagery":n,"cultural":n,"originality":n},"B":{...}}`;

async function gen(client: Anthropic, model: string, prompt: string, max = 700): Promise<string> {
  const res = await client.messages.create({ model, max_tokens: max, ...(model === BASELINE_MODEL ? { thinking: { type: "disabled" as const } } : {}), messages: [{ role: "user", content: prompt }] });
  return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}
const writePrompt = (language: string, style: string, brief: string) =>
  `Write original song lyrics in ${language} (native script only, no transliteration, no translation) in the style family "${style}". Brief: ${brief}. ${STRUCTURE_TARGET} Use section tags like [Pallavi]/[Charanam] or [Verse]/[Chorus] as fits the style. Output only the lyrics.`;

export async function singleShot(client: Anthropic, language: string, style: string, brief: string): Promise<string> {
  return gen(client, BASELINE_MODEL, writePrompt(language, style, brief));
}

/** Stronger baseline: 6 Haiku drafts, then Sonnet picks the best and lightly revises it (controls for "PCE just samples more"). */
export async function bestOfSix(client: Anthropic, language: string, style: string, brief: string): Promise<string> {
  const drafts = await Promise.all(Array.from({ length: 6 }, () => gen(client, BASELINE_MODEL, writePrompt(language, style, brief))));
  return gen(client, JUDGE_MODEL, `You are a lyricist in ${language}. Brief: ${brief}. ${STRUCTURE_TARGET}\nBelow are 6 drafts. Choose the one with the best meter, diction, imagery and cultural fit, fix any flaws in it (keep native script, keep the length), and output ONLY the final lyrics.\n\n${drafts.map((d, i) => `--- DRAFT ${i + 1} ---\n${d}`).join("\n\n")}`, 600);
}

type Scores = Record<Dim, number>;
async function once(client: Anthropic, language: string, brief: string, a: string, b: string): Promise<{ A: Scores; B: Scores } | null> {
  const res = await client.messages.create({
    model: JUDGE_MODEL, max_tokens: 500, system: RUBRIC,
    messages: [{ role: "user", content: `Language: ${language}\nBrief: ${brief}\n\n=== LYRIC A ===\n${a}\n\n=== LYRIC B ===\n${b}` }],
  });
  const text = res.content.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("");
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { A: Scores; B: Scores };
    for (const k of ["A", "B"] as const) for (const d of DIMS) if (!(j[k]?.[d] >= 1 && j[k][d] <= 5)) return null;
    return { A: j.A, B: j.B };
  } catch { return null; }
}

/** Blind pairwise scoring in both orders. Per-dimension scores are averaged over orders (removes position bias);
 *  a pair is a win when the total differs by >= 1.0 point (of 25) in the same direction. */
export async function judgePair(client: Anthropic, language: string, brief: string, pce: string, other: string) {
  const [first, second] = await Promise.all([once(client, language, brief, pce, other), once(client, language, brief, other, pce)]);
  if (!first || !second) return { winner: "tie" as const, detail: { error: "unparseable judge output" } };
  const dim = {} as Record<Dim, number>; let total = 0;
  for (const d of DIMS) { dim[d] = ((first.A[d] - first.B[d]) + (second.B[d] - second.A[d])) / 2; total += dim[d]; }
  const winner = total >= 1 ? "pce" : total <= -1 ? "single" : "tie";
  return { winner: winner as "pce" | "single" | "tie", detail: { total_diff: total, dim_diff: dim } };
}
