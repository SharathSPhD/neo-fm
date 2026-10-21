/** Pure helpers for the premium now-playing view (flag STATION_NOW_PLAYING): segment kinds, up-next and lock-screen text. */

export type SegmentKind = "track" | "ad" | "voice";

interface Segmented {
  title: string;
  language: string;
  type?: "ad" | "voice";
  ad?: { headline: string } | undefined;
}

export function nowPlayingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STATION_NOW_PLAYING === "1";
}

export function segmentKind(t: { type?: "ad" | "voice" } | null | undefined): SegmentKind {
  return t?.type === "ad" ? "ad" : t?.type === "voice" ? "voice" : "track";
}

/** What plays after the head of the queue, or null when the queue holds nothing further. */
export function upNext<T extends Segmented>(queue: readonly T[]): { kind: SegmentKind; track: T } | null {
  const next = queue[1];
  return next ? { kind: segmentKind(next), track: next } : null;
}

/** Lock-screen text: ads and host links never show their internal titles as if they were songs. */
export function lockScreenText(
  t: Segmented,
  labels: { ad: string; host: string; language: string },
): { title: string; album: string } {
  const kind = segmentKind(t);
  if (kind === "ad") return { title: labels.ad, album: "neo-fm" };
  if (kind === "voice") return { title: labels.host, album: "neo-fm" };
  return { title: t.title, album: labels.language };
}
