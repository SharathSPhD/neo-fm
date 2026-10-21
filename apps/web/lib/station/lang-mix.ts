/**
 * Language mix for the Station pass (strategy/station-pass-and-lake.md section 4): the listener picks up to three languages
 * with weights ("ta:60,hi:30,en:10") and one station plays them in runs, so it feels like one programme and not a shuffle
 * of unrelated stations. Pure functions; the queue route decides who is entitled (flag STATION_PASS_MIX plus pass perks).
 */
export const MAX_MIX_LANGS = 3;
/** Shortest run of one language before the mix may switch; sets inside a run stay single-language (lib/station/sets.ts). */
export const MIN_RUN = 2;

export interface MixEntry { lang: string; weight: number }

export function passMixEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STATION_PASS_MIX === "1";
}

/** "ta:60,hi:30" or "ta,hi" (equal weights) to normalised entries; unknown codes, bad weights and duplicates are dropped. */
export function parseMix(raw: string | null | undefined, known: (lang: string) => boolean): MixEntry[] {
  const seen = new Set<string>();
  const out: MixEntry[] = [];
  for (const part of (raw ?? "").split(",").slice(0, 8)) {
    const [code, w] = part.trim().toLowerCase().split(":");
    if (!code || seen.has(code) || !known(code)) continue;
    const weight = w === undefined || w === "" ? 1 : Number(w);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    seen.add(code);
    out.push({ lang: code, weight });
    if (out.length === MAX_MIX_LANGS) break;
  }
  const total = out.reduce((s, e) => s + e.weight, 0);
  return out.map((e) => ({ ...e, weight: e.weight / total }));
}

/**
 * Interleave per-language lists in runs of MIN_RUN (or more), choosing the next language whose played share is furthest
 * below its weight. A list that runs out is skipped, so a thin language never blocks the rest.
 */
export function interleaveMix<T>(lists: { weight: number; tracks: readonly T[] }[], limit: number): T[] {
  const taken = lists.map(() => 0);
  const out: T[] = [];
  while (out.length < limit) {
    const total = Math.max(1, out.length);
    let best = -1;
    let bestGap = -Infinity;
    lists.forEach((l, i) => {
      if (taken[i]! >= l.tracks.length) return;
      const gap = l.weight - taken[i]! / total;
      if (gap > bestGap) { bestGap = gap; best = i; }
    });
    if (best < 0) break;
    for (let r = 0; r < MIN_RUN && out.length < limit && taken[best]! < lists[best]!.tracks.length; r++) out.push(lists[best]!.tracks[taken[best]!++]!);
  }
  return out;
}
