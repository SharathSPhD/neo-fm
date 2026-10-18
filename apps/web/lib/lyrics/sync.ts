/**
 * Line-level timing for the synced lyrics panel.
 *
 * The renderer gives us per-section target durations but no word
 * timestamps, so each section's time is shared between its lines in
 * proportion to their length. If the real audio length differs from the
 * sum of the targets (it usually does by a few seconds) everything is
 * scaled to fit, so the last line ends when the track does.
 */

import { charErrorRate } from "../diction";

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
  const heard = [...timings.lines].sort((a, b) => a.start_s - b.start_s);
  // The timings were measured on the lyrics the renderer sang (agent_runs.lyrics), which can differ from the
  // page's section lyrics (a closing hook repeat, a polish edit). So match line by line on text, in order,
  // rather than demanding equal counts; unmatched lines are interpolated between their heard neighbours.
  const matched = matchHeard(paced, heard);
  const hits = matched.filter((m) => m !== null).length;
  if (heard.length === paced.length && hits < paced.length / 2) {
    // Same shape but different words (e.g. a transliterated page): trust position, as before.
    return paced.map((line, idx) => ({ ...line, start: heard[idx]!.start_s, end: heard[idx]!.end_s, sung: heard[idx]!.sung }));
  }
  // Too few anchors to trust: even pacing is honest, a confidently wrong highlight is not.
  if (hits < Math.max(2, paced.length / 2)) return paced;
  return interpolate(paced, matched);
}

type HeardLine = LineTimings["lines"][number];

function norm(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 6 && long.includes(short)) return true;
  return charErrorRate(a, b) <= 0.3;
}

/** For each page line, the heard line sung for it (in order, each heard line used once), or null. */
function matchHeard(paced: readonly SyncLine[], heard: readonly HeardLine[]): (HeardLine | null)[] {
  const hn = heard.map((h) => norm(h.text));
  const out: (HeardLine | null)[] = [];
  let j = 0;
  for (const line of paced) {
    const n = norm(line.text);
    let hit = -1;
    for (let k = j; k < heard.length; k++) {
      if (close(n, hn[k]!)) { hit = k; break; }
    }
    if (hit >= 0) { out.push(heard[hit]!); j = hit + 1; } else out.push(null);
  }
  return out;
}

/** Heard lines keep their times; runs of unmatched lines share the gap between their heard neighbours by length. */
function interpolate(paced: readonly SyncLine[], matched: readonly (HeardLine | null)[]): SyncLine[] {
  const res: SyncLine[] = paced.map((l, i) => {
    const m = matched[i];
    return m ? { ...l, start: m.start_s, end: m.end_s, sung: m.sung } : { ...l, sung: false };
  });
  let i = 0;
  while (i < res.length) {
    if (matched[i]) { i++; continue; }
    let k = i;
    while (k < res.length && !matched[k]) k++;
    const from = i > 0 ? res[i - 1]!.end : 0;
    const to = k < res.length ? res[k]!.start : Math.max(from, paced[paced.length - 1]!.end);
    const span = Math.max(0, to - from);
    const w = res.slice(i, k).map((l) => weight(l.text));
    const total = w.reduce((a, b) => a + b, 0);
    let t = from;
    for (let n = i; n < k; n++) {
      const d = (span * w[n - i]!) / total;
      res[n] = { ...res[n]!, start: t, end: t + d, sung: false };
      t += d;
    }
    i = k;
  }
  return res;
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
