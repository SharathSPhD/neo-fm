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
  /** False when the time is interpolated rather than heard in the audio. */
  sung?: boolean;
}

/** agent_runs.line_timings (version 1), produced from the diction transcription. */
export interface LineTimings {
  version: 1;
  duration_s?: number;
  source?: string;
  lines: { i: number; text: string; start_s: number; end_s: number; sung: boolean }[];
}

export function parseLineTimings(raw: unknown): LineTimings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<LineTimings>;
  if (r.version !== 1 || !Array.isArray(r.lines) || r.lines.length === 0) return null;
  const ok = r.lines.every(
    (l) =>
      l &&
      typeof l.text === "string" &&
      Number.isFinite(l.start_s) &&
      Number.isFinite(l.end_s) &&
      l.end_s >= l.start_s,
  );
  return ok ? (r as LineTimings) : null;
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
  timings?: LineTimings | null,
): SyncLine[] {
  const paced = paceEvenly(sections, audioSeconds);
  if (!timings) return paced;
  // Heard timings win, but only when they describe these same lyrics: if
  // the line count differs (lyrics edited since the audit) fall back to
  // even pacing rather than highlight the wrong lines.
  const heard = [...timings.lines].sort((a, b) => a.start_s - b.start_s);
  if (heard.length !== paced.length) return paced;
  return paced.map((line, idx) => ({
    ...line,
    start: heard[idx]!.start_s,
    end: heard[idx]!.end_s,
    sung: heard[idx]!.sung,
  }));
}

function paceEvenly(
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
