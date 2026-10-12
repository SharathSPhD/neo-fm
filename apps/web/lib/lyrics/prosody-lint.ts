import { lineProsody } from "../diction";

export interface MeterIssue { pair: [number, number]; lines: [string, string]; counts: [number, number]; reason: string }

/** Lyric lines only: drops blank lines, [section] tags, '# title' lines and bold markdown section tags. */
export function lyricLines(lyrics: string): string[] {
  return lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l) && !/^\*{0,2}\[.*\]\*{0,2}$/.test(l) && !/^\*{0,2}\(.*\)\*{0,2}$/.test(l));
}

/**
 * Deterministic meter check: consecutive lines (1-2, 3-4, ...) are meant to sing to the same tune, so their akshara
 * counts should be close. Flags pairs differing by more than max(2, 25%) so the polish pass fixes exactly those lines.
 */
export function meterIssues(lyrics: string): MeterIssue[] {
  const lines = lyricLines(lyrics);
  const out: MeterIssue[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const a = lineProsody(lines[i]!).count, b = lineProsody(lines[i + 1]!).count;
    const tol = Math.max(2, Math.round(0.25 * Math.max(a, b)));
    if (a > 0 && b > 0 && Math.abs(a - b) > tol) {
      out.push({ pair: [i + 1, i + 2], lines: [lines[i]!, lines[i + 1]!], counts: [a, b], reason: `${a} vs ${b} syllables` });
    }
  }
  return out;
}

export function meterReport(issues: MeterIssue[]): string {
  return issues.map((m) => `- lines ${m.pair[0]} and ${m.pair[1]} (${m.reason}): "${m.lines[0]}" / "${m.lines[1]}"`).join("\n");
}
