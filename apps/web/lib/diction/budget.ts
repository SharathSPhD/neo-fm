/**
 * Clip-length lyric budget (experiment, off by default; nothing in lib/agent calls this yet).
 * A 30 s Lyria clip cannot sing every line when lines are long: in the 2026-10-12 sweep 5 of 50 songs lost their
 * last 1-2 lines. The budget counts syllables (independent vowels + consonants, minus virama joins) and drops
 * trailing whole lines past `budget`, never splitting a line and always keeping at least `minLines`.
 */
export const CLIP_SYLLABLE_BUDGET = 70;

export function syllables(line: string): number {
  const t = line.normalize("NFC");
  return (t.match(/\p{Lo}/gu) ?? []).length - (t.match(/[्্்్್]/gu) ?? []).length;
}

export function fitToClipBudget(lines: string[], budget = CLIP_SYLLABLE_BUDGET, minLines = 3): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const l of lines) {
    const s = syllables(l);
    if (kept.length >= minLines && used + s > budget) break;
    kept.push(l);
    used += s;
  }
  return kept;
}

/** Experiment flag: CLIP_SYLLABLE_BUDGET=<n> enables the cap; unset/0/invalid leaves lyrics untouched. */
export function clipBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number(env.CLIP_SYLLABLE_BUDGET);
  return Number.isFinite(n) && n > 0 ? n : null;
}
