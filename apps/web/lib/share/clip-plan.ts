/**
 * Pure planning for the 9:16 share clip: which 15-30 s of the song to use and
 * what the lyric stack looks like at a given moment. No DOM, so it is unit-tested.
 */
import type { SyncLine } from "@/lib/lyrics/sync";

export const CLIP_MIN_SECONDS = 15;
export const CLIP_MAX_SECONDS = 30;

export interface ClipWindow {
  start: number;
  end: number;
}

/** Sections that carry the hook; a clip that opens on one is the one people replay. */
const HOOK_SECTION = /chorus|hook|refrain|pallavi|mukhda/i;

/**
 * Pick the window to export. Starts on a line boundary so the clip never opens
 * mid-word, runs up to `max` seconds, and prefers windows heavy in heard
 * (non-interpolated) hook lines. Tracks shorter than `min` export whole.
 */
export function pickClipWindow(
  lines: readonly SyncLine[],
  totalSeconds: number,
  opts: { min?: number; max?: number } = {},
): ClipWindow {
  const min = opts.min ?? CLIP_MIN_SECONDS;
  const max = opts.max ?? CLIP_MAX_SECONDS;
  if (!(totalSeconds > 0)) return { start: 0, end: 0 };
  if (totalSeconds <= min) return { start: 0, end: totalSeconds };
  if (lines.length === 0) return { start: 0, end: Math.min(max, totalSeconds) };

  let best: ClipWindow = { start: 0, end: Math.min(max, totalSeconds) };
  let bestScore = -1;
  for (const cand of lines) {
    const start = Math.min(cand.start, Math.max(0, totalSeconds - min));
    const limit = Math.min(start + max, totalSeconds);
    let score = 0;
    let lastEnd = start;
    for (const l of lines) {
      if (l.end <= start || l.start >= limit) continue;
      // Only whole lines count, for the score and the end, so the clip never cuts a line short.
      if (l.end > limit) continue;
      lastEnd = Math.max(lastEnd, l.end);
      const w = l.sung === false ? 0.5 : 1;
      score += w * (HOOK_SECTION.test(l.sectionType) ? 2 : 1);
    }
    const end = Math.min(totalSeconds, Math.max(lastEnd + 0.6, start + min));
    if (score > bestScore) {
      bestScore = score;
      best = { start, end: Math.min(end, start + max) };
    }
  }
  return best;
}

export interface ClipFrameState {
  /** Index of the line being sung, or -1 in an instrumental gap. */
  active: number;
  /** 0..1 through the active line (0 when none). */
  progress: number;
  /** 0..1 through the clip. */
  clipProgress: number;
}

export function clipFrameState(
  lines: readonly SyncLine[],
  window: ClipWindow,
  t: number,
): ClipFrameState {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.start <= t && t < lines[i]!.end) active = i;
  }
  // Hold the last-heard line through a short gap instead of flashing blank.
  if (active < 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.end <= t && t - lines[i]!.end < 1.2) { active = i; break; }
    }
  }
  const l = active >= 0 ? lines[active]! : null;
  const progress = l ? Math.min(1, Math.max(0, (t - l.start) / Math.max(0.001, l.end - l.start))) : 0;
  const span = Math.max(0.001, window.end - window.start);
  return { active, progress, clipProgress: Math.min(1, Math.max(0, (t - window.start) / span)) };
}

/** Greedy word wrap; falls back to per-grapheme breaks for a single over-long word. */
export function wrapText(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  const push = (w: string) => {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxWidth) { cur = next; return; }
    if (cur) out.push(cur);
    if (measure(w) <= maxWidth) { cur = w; return; }
    cur = "";
    for (const ch of Array.from(w)) {
      if (cur && measure(cur + ch) > maxWidth) { out.push(cur); cur = ch; } else cur += ch;
    }
  };
  words.forEach(push);
  if (cur) out.push(cur);
  return out;
}
