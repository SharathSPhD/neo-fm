/**
 * Genre router: listener intent (free text, language, mood, daypart, theme) to ranked Indian music styles.
 *
 * Pure and deterministic, no network and no spend. Resolution order (strategy/indian-music-styles.md): explicit style
 * keyword, then mood/daypart/theme, then the language default list. Instrumental requests only get styles Lyria renders
 * voice-free (lab R5: raga, folk and devotional prompts are sung over 75 to 100 percent of the time).
 */
import { FESTIVALS, ROUTING, STYLES, getStyle, isGeneratable, type MusicStyle } from "./registry";

export interface StyleQuery {
  text?: string;
  /** Song language code (hi, ta, ...). Styles for other languages are skipped. */
  language?: string;
  mood?: string;
  daypart?: string;
  theme?: string;
  /** True for a wordless track. */
  instrumental?: boolean;
  /** Admit styles Lyria has never rendered in this language (wave 2). Off by default. */
  allowUntested?: boolean;
}

export type RouteReason = "keyword" | "mood-daypart" | "language-default";
export interface StyleChoice {
  style: MusicStyle;
  score: number;
  reason: RouteReason;
}

/** Keys are matched on word boundaries for Latin text and as substrings for other scripts. */
function mentions(text: string, key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;
  if (!/^[a-z0-9 \-]+$/.test(k)) return text.includes(k);
  const escaped = k.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
}

function languageFits(s: MusicStyle, language: string | undefined, instrumental: boolean): boolean {
  if (!language) return true;
  if (s.languages.includes(language)) return true;
  // A wordless style serves any language.
  return instrumental && s.languages.includes("zxx");
}

function allowed(s: MusicStyle, q: StyleQuery): boolean {
  if (!isGeneratable(s)) return false;
  const instrumental = q.instrumental === true;
  if (instrumental) return s.lyria_instrumental === "ok";
  if (s.lyria_vocal === "na") return false;
  if (s.lyria_vocal === "untested" && !q.allowUntested) return false;
  return true;
}

const PRIORITY_BONUS: Record<string, number> = { launch: 5, "launch-conditional": 3, "v1.1": 2, wave2: 1, later: 0 };

export function routeStyles(q: StyleQuery, limit = 3): StyleChoice[] {
  const instrumental = q.instrumental === true;
  const text = (q.text ?? "").toLowerCase();
  const scores = new Map<string, StyleChoice>();
  const bump = (s: MusicStyle, add: number, reason: RouteReason) => {
    if (!allowed(s, q) || !languageFits(s, q.language, instrumental)) return;
    const cur = scores.get(s.id);
    if (cur) {
      cur.score += add;
      if (reason === "keyword") cur.reason = "keyword";
    } else {
      scores.set(s.id, { style: s, score: add + (PRIORITY_BONUS[s.launch_priority] ?? 0), reason });
    }
  };

  if (text) {
    for (const [key, id] of Object.entries(ROUTING.keyword_map)) {
      const s = getStyle(id);
      if (s && mentions(text, key)) bump(s, 100, "keyword");
    }
    for (const f of FESTIVALS) {
      if (!mentions(text, f.festival.split("/")[0]!.trim())) continue;
      for (const id of f.styles) {
        const s = getStyle(id);
        if (s) bump(s, 40, "keyword");
      }
    }
  }

  for (const s of STYLES) {
    let add = 0;
    if (q.mood && s.moods.includes(q.mood)) add += 10;
    if (q.daypart && s.dayparts.includes(q.daypart)) add += 8;
    if (q.theme && s.themes.includes(q.theme)) add += 6;
    if (add > 0) bump(s, add, "mood-daypart");
  }

  if (scores.size === 0 && q.language) {
    (ROUTING.by_language[q.language] ?? []).forEach((id, i) => {
      const s = getStyle(id);
      if (s) bump(s, 20 - i, "language-default");
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score || a.style.id.localeCompare(b.style.id)).slice(0, limit);
}

/** The Lyria style hint for a style: the style's own language when it has one, English otherwise. */
export function lyriaHint(s: MusicStyle, language?: string): { native: string | null; english: string } {
  const h = s.lyria_hint_native;
  const native = typeof h === "string" ? (language && !s.languages.includes(language) ? null : h) : (language ? h[language] ?? null : null);
  return { native, english: s.lyria_hint_en };
}

/** Constraint lines PCE needs before writing: form, metre, sections and the clichés to avoid. */
export function pceConstraint(s: MusicStyle): { form: string; metre: string; sections: string[]; mustAvoid: string[] } {
  return { form: s.lyric_form, metre: s.metre, sections: s.pce_sections, mustAvoid: s.must_avoid };
}
