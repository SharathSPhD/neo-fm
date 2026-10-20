/** Prompts and parsers for the critique-and-revise step (inference-time RLAIF: the judge rubric is also the editor's brief). */
export const DIMS = ["prosody", "diction", "imagery", "cultural", "originality", "fidelity"] as const;
export type CritiqueDim = (typeof DIMS)[number];

export interface Critique {
  scores: Record<CritiqueDim, number>;
  weak: { line: string; problem: string; direction: string }[];
  verdict: "keep" | "revise";
}

export function critiquePrompt(a: { language: string; style: string; brief: string; lyrics: string; playbook?: string }): string {
  return `You are a harsh but fair senior lyricist and editor in ${a.language} (style family: ${a.style}), reviewing a 30-second song lyric for the brief below.
Brief: ${a.brief}
${a.playbook ? `\nCRAFT NOTES for this language:\n${a.playbook}\n` : ""}
Score the lyric 1-5 (3 = competent, 5 = outstanding) on: ${DIMS.join(", ")}.
Then name at most 3 weakest lines, copying each line EXACTLY as written, with the problem (stock phrase, translated-sounding, invented word, broken rhyme, unsingable length, off-brief, vague image) and a short direction for a better version. Do not rewrite the lines yourself.
If nothing is clearly weak, set verdict "keep" and weak [].
Reply with ONLY JSON: {"scores":{${DIMS.map((d) => `"${d}":n`).join(",")}},"weak":[{"line":"...","problem":"...","direction":"..."}],"verdict":"keep|revise"}

--- LYRIC ---
${a.lyrics}`;
}

export function parseCritique(text: string): Critique | null {
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Critique;
    for (const d of DIMS) if (!(j.scores?.[d] >= 1 && j.scores[d] <= 5)) return null;
    const weak = (Array.isArray(j.weak) ? j.weak : []).filter((w) => typeof w?.line === "string" && w.line.trim().length > 0).slice(0, 3);
    return { scores: j.scores, weak, verdict: j.verdict === "keep" || weak.length === 0 ? "keep" : "revise" };
  } catch { return null; }
}

export function revisePrompt(a: { language: string; style: string; brief: string; lyrics: string; critique: Critique; playbook?: string }): string {
  return `You are a senior lyricist in ${a.language} (style family: ${a.style}). Brief: ${a.brief}
${a.playbook ? `\nCRAFT NOTES for this language:\n${a.playbook}\n` : ""}
An editor flagged these lines of the lyric below:
${a.critique.weak.map((w, i) => `${i + 1}. "${w.line}" -> ${w.problem}. Direction: ${w.direction}`).join("\n")}
Rewrite ONLY the flagged lines (and, if a rhyme demands it, the partner line). Every other line stays exactly as it is. Keep the section tags, the number of lines and native script only. Natural spoken-poetic words beat forced syllable counts: never invent words to hit a count.
Output ONLY the final lyrics, no commentary.

--- LYRIC ---
${a.lyrics}`;
}

/** Listwise pick among N candidates shown in a caller-chosen (shuffled) order. Returns the 0-based index of the best, or null. */
export function selectPrompt(a: { language: string; style: string; brief: string; cands: string[] }): string {
  return `You are a native-level lyric judge in ${a.language} (style family: ${a.style}). Brief: ${a.brief}
${a.cands.length} lyrics were written for it. Pick the one a native listener would find most natural, vivid and singable: diction and idiom first, then imagery and fit to the brief, then prosody. Invented or ungrammatical words lose. Do not prefer length.
Reply with ONLY JSON: {"best":<number 1-${a.cands.length}>,"reason":"<=25 words"}

${a.cands.map((c, i) => `=== LYRIC ${i + 1} ===\n${c}`).join("\n\n")}`;
}

export function parseSelect(text: string, n: number): number | null {
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { best?: number };
    return Number.isInteger(j.best) && j.best! >= 1 && j.best! <= n ? j.best! - 1 : null;
  } catch { return null; }
}
