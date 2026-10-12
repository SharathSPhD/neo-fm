/**
 * Line-level timing for the synced lyrics panel.
 *
 * The renderer gives us per-section target durations but no word
 * timestamps, so each section's time is shared between its lines in
 * proportion to their length. If the real audio length differs from the
 * sum of the targets (it usually does by a few seconds) everything is
 * scaled to fit, so the last line ends when the track does.
 */

export interface SyncSectionInput {
  id: string;
  type: string;
  target_seconds: number;
  lyrics?: string;
}

export interface SyncLine {
  key: string;
  sectionId: string;
  sectionType: string;
  /** Index of this line inside its section; 0 marks the section's first line. */
  lineInSection: number;
  text: string;
  start: number;
  end: number;
}

function weight(text: string): number {
  // Count user-perceived characters so conjuncts in Indic scripts are not
  // over-weighted; Intl.Segmenter is available in all supported runtimes.
  const Seg = (Intl as unknown as {
    Segmenter?: new (l?: string, o?: { granularity: "grapheme" }) => {
      segment(s: string): Iterable<unknown>;
    };
  }).Segmenter;
  const n = Seg
    ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(text)).length
    : Array.from(text).length;
  return Math.max(4, n);
}

export function buildLyricTimeline(
  sections: readonly SyncSectionInput[],
  audioSeconds?: number | null,
): SyncLine[] {
  const targetTotal = sections.reduce(
    (sum, s) => sum + Math.max(0, s.target_seconds),
    0,
  );
  const scale =
    audioSeconds && isFinite(audioSeconds) && audioSeconds > 0 && targetTotal > 0
      ? audioSeconds / targetTotal
      : 1;

  const lines: SyncLine[] = [];
  let cursor = 0;
  for (const s of sections) {
    const span = Math.max(0, s.target_seconds) * scale;
    const texts = (s.lyrics ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (texts.length > 0) {
      const weights = texts.map(weight);
      const wTotal = weights.reduce((a, b) => a + b, 0);
      let t = cursor;
      texts.forEach((text, i) => {
        const dur = (span * weights[i]!) / wTotal;
        lines.push({
          key: `${s.id}:${i}`,
          sectionId: s.id,
          sectionType: s.type,
          lineInSection: i,
          text,
          start: t,
          end: t + dur,
        });
        t += dur;
      });
    }
    cursor += span;
  }
  return lines;
}

/** Index of the line playing at time `t`, or -1 before the first line starts. */
export function activeLineIndex(lines: readonly SyncLine[], t: number): number {
  if (lines.length === 0 || t < lines[0]!.start) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
