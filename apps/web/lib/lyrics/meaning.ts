import type Anthropic from "@anthropic-ai/sdk";

import { romanizeLine } from "../diction/romanize";
import { lyricLines } from "./prosody-lint";
import type { SyncSectionInput } from "./sync";

export const MEANING_MODEL = "claude-haiku-5-5";

/** Cost guards for the meaning route. They live here, not in the route file, because Next.js rejects unknown route exports. */
export const MEANING_DAILY_CAP = 20;
export const FAILURE_CACHE_MS = 10 * 60 * 1000;
/** Ledger units (GBP) reserved per generation: one Haiku call over a few thousand tokens, rounded up. */
export const MEANING_COST_GBP = 0.005;
/** Shown wherever the English line appears. */
export const MEANING_DISCLAIMER = "English meaning is an AI machine translation. It conveys the sense, not the poetry, and may miss cultural nuance.";

export interface MeaningLine { section_id: string; original: string; roman: string; english: string }

/** One entry per lyric line (section tags, blank lines and '# title' lines dropped), in song order. */
export function flattenLyricLines(sections: readonly SyncSectionInput[]): { section_id: string; original: string }[] {
  const out: { section_id: string; original: string }[] = [];
  for (const s of sections) for (const original of lyricLines(s.lyrics ?? "")) out.push({ section_id: s.id, original });
  return out;
}

export function buildMeaningPrompt(language: string, lines: readonly string[]): string {
  return `Translate these ${language} song lyric lines into plain English that conveys the meaning. Rules:
- Return ONLY a JSON array of exactly ${lines.length} strings, one per input line, in order. No commentary, no code fence.
- Translate faithfully; do not add, censor or embellish. Keep imagery literal where it is clear. Keep each translation to one short line.
- If a line is already English or is only a sound (e.g. "aa", "la la"), return it unchanged.

Lines:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

/** Accepts a bare JSON array or one wrapped in a code fence; returns null unless it is exactly `n` strings. */
export function parseMeaning(text: string, n: number): string[] | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const v: unknown = JSON.parse(body);
    if (!Array.isArray(v) || v.length !== n || !v.every((x) => typeof x === "string")) return null;
    return (v as string[]).map((x) => x.trim());
  } catch {
    return null;
  }
}

export async function generateMeaning(
  client: Anthropic,
  a: { language: string; sections: readonly SyncSectionInput[] },
): Promise<MeaningLine[]> {
  const flat = flattenLyricLines(a.sections);
  if (flat.length === 0) return [];
  const res = await client.messages.create({
    model: MEANING_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: buildMeaningPrompt(a.language, flat.map((f) => f.original)) }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const english = parseMeaning(text, flat.length);
  if (!english) throw new Error(`meaning_parse_failed (stop=${res.stop_reason})`);
  return flat.map((f, i) => ({ ...f, roman: romanizeLine(f.original), english: english[i]! }));
}
