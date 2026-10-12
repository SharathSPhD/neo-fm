/** Pure helpers for the public creator profile page. */

export interface ProfileSong {
  id: string;
  public_id: string;
  published_at: string | null;
  title: string | null;
  language: string;
  style_family: string;
  like_count: number;
}

export interface LanguageGroup {
  language: string;
  songs: ProfileSong[];
}

/** Languages in the order launch copy lists them; unknown codes sort after, alphabetically. */
const LANGUAGE_ORDER = ["kn", "ta", "te", "hi", "bn", "en", "sa"];

/**
 * Group songs by language, biggest group first (ties by launch order), newest song first inside a group.
 */
export function groupByLanguage(songs: readonly ProfileSong[]): LanguageGroup[] {
  const map = new Map<string, ProfileSong[]>();
  for (const s of songs) {
    const list = map.get(s.language) ?? [];
    list.push(s);
    map.set(s.language, list);
  }
  const rank = (l: string) => {
    const i = LANGUAGE_ORDER.indexOf(l);
    return i === -1 ? LANGUAGE_ORDER.length : i;
  };
  return [...map.entries()]
    .map(([language, list]) => ({
      language,
      songs: [...list].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")),
    }))
    .sort(
      (a, b) =>
        b.songs.length - a.songs.length ||
        rank(a.language) - rank(b.language) ||
        a.language.localeCompare(b.language),
    );
}

export interface ProfileStats {
  songs: number;
  languages: number;
  likes: number;
}

export function profileStats(songs: readonly ProfileSong[]): ProfileStats {
  return {
    songs: songs.length,
    languages: new Set(songs.map((s) => s.language)).size,
    likes: songs.reduce((n, s) => n + s.like_count, 0),
  };
}

/** One-line summary used for the meta description and share text. */
export function profileBlurb(handle: string, stats: ProfileStats, languageNames: readonly string[]): string {
  if (stats.songs === 0) return `@${handle} is on neo-fm.`;
  const songs = `${stats.songs} ${stats.songs === 1 ? "song" : "songs"}`;
  const langs =
    languageNames.length === 0
      ? ""
      : languageNames.length <= 3
        ? ` in ${languageNames.join(", ")}`
        : ` in ${languageNames.length} languages`;
  return `@${handle} has made ${songs}${langs} on neo-fm.`;
}

/** First letter of a handle for the generated avatar. */
export function avatarInitial(handle: string): string {
  const ch = handle.replace(/^@/, "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

/**
 * Deterministic avatar colours as hex. Hex rather than hsl() so the same values work in the
 * page and in the satori-rendered share card, which cannot parse hsl().
 */
export function avatarColors(handle: string): { from: string; to: string } {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) & 0xffff;
  const hueA = h % 360;
  const hueB = (hueA + 40 + ((h >> 8) % 30)) % 360;
  return { from: hslToHex(hueA, 0.55, 0.36), to: hslToHex(hueB, 0.6, 0.2) };
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
