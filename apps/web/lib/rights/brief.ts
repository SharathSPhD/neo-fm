/**
 * Deterministic brief screen for rights risk: (1) asking to imitate a named real artist, (2) asking to reproduce an
 * existing song's lyrics. Runs before any model or paid call; multilingual (en, hi, ta, te, kn, bn + Hinglish).
 * A bare artist name with no imitation cue is returned as a `flag`, not a block: "a tribute to Lata Mangeshkar" is fine.
 */
import { ARTIST_ALIASES } from "./artists";
import { EXPLICIT_REPRODUCTION, IMITATION_CUES, LYRICS_CUES } from "./cues";
import { MESSAGES, type RightsKind } from "./messages";
import { containsPhrase, detectLang, normaliseText, type Lang } from "./normalise";
import { KNOWN_TITLES } from "./titles";

export type RightsVerdict =
  | { ok: true; flags: string[] }
  | { ok: false; kind: RightsKind; category: "artist_impersonation" | "copyrighted_lyrics"; matched: string; lang: Lang; message: string; suggestion: string };

/** A cue counts only if it sits close to the name, so "like a lullaby" elsewhere in the brief doesn't implicate it. */
const NEAR = 40;

function positions(hay: string, needle: string): number[] {
  const out: number[] = []; if (!needle) return out;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const before = hay[i - 1]; const after = hay[i + needle.length];
    // Latin needles must be whole words; Indic ones can carry case suffixes.
    if (/^[a-z0-9 ]+$/.test(needle) && ((before && before !== " ") || (after && after !== " "))) continue;
    out.push(i);
  }
  return out;
}

function cueNear(hay: string, at: number, len: number, cues: string[]): string | null {
  const lo = Math.max(0, at - NEAR); const hi = Math.min(hay.length, at + len + NEAR);
  const window = hay.slice(lo, hi);
  for (const c of cues) {
    for (const p of positions(window, c)) {
      const abs = lo + p;
      if (abs + c.length <= at || abs >= at + len) return c; // outside the name itself
    }
  }
  return null;
}

function refuse(kind: RightsKind, matched: string, text: string, langHint?: string): RightsVerdict {
  const lang = detectLang(text, langHint);
  const m = MESSAGES[kind][lang];
  return { ok: false, kind, category: kind === "artist_imitation" ? "artist_impersonation" : "copyrighted_lyrics", matched, lang, message: m.message, suggestion: m.suggestion };
}

export function screenBrief(raw: string, opts: { lang?: string } = {}): RightsVerdict {
  const text = normaliseText(raw);
  const flags: string[] = [];

  const explicit = EXPLICIT_REPRODUCTION.find((c) => containsPhrase(text, c));
  if (explicit) return refuse("lyrics_reproduction", explicit, raw, opts.lang);

  const named: { artist: string; alias: string; at: number }[] = [];
  for (const { artist, alias } of ARTIST_ALIASES) for (const at of positions(text, alias)) named.push({ artist, alias, at });

  for (const n of named) {
    const cue = cueNear(text, n.at, n.alias.length, IMITATION_CUES);
    if (cue) return refuse("artist_imitation", n.artist, raw, opts.lang);
    flags.push(`artist_mentioned:${n.artist}`);
  }

  const lyricsCue = LYRICS_CUES.find((c) => containsPhrase(text, c));
  if (lyricsCue) {
    const title = KNOWN_TITLES.find((t) => containsPhrase(text, t));
    const quoted = /["“”«»'‘’][^"“”«»'‘’]{2,80}["“”«»'‘’]/.test(raw);
    if (title) return refuse("lyrics_reproduction", title, raw, opts.lang);
    if (named.length) return refuse("lyrics_reproduction", named[0]!.artist, raw, opts.lang);
    if (quoted) return refuse("lyrics_reproduction", lyricsCue, raw, opts.lang);
  }
  for (const t of KNOWN_TITLES) if (containsPhrase(text, t)) flags.push(`title_mentioned:${t}`);
  return { ok: true, flags };
}
