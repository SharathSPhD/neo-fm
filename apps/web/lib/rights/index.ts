/**
 * Rights-safety entry points. `screenRights` is called from lib/safety `screenRequest`, which already guards every brief
 * (POST /api/songs) and every pre-render lyrics check in the agent pipeline, so no lib/agent change is needed.
 */
import { MESSAGES } from "./messages";
import { detectLang } from "./normalise";
import { screenBrief } from "./brief";
import { checkVerbatimOverlap, type Reference } from "./verbatim";
import REFERENCE from "./reference-fingerprints.json";

export type RightsDecision = { allowed: true } | { allowed: false; category: "artist_impersonation" | "copyrighted_lyrics"; reason: string };

export function screenRights(text: string, kind: "brief" | "lyrics", opts: { lang?: string; references?: Reference[] } = {}): RightsDecision {
  if (kind === "brief") {
    const v = screenBrief(text, { lang: opts.lang });
    return v.ok ? { allowed: true } : { allowed: false, category: v.category, reason: `${v.message} ${v.suggestion}` };
  }
  const o = checkVerbatimOverlap(text, opts.references ?? (REFERENCE as Reference[]));
  if (o.ok) return { allowed: true };
  const m = MESSAGES.verbatim_overlap[detectLang(text, opts.lang)];
  return { allowed: false, category: "copyrighted_lyrics", reason: `${m.message} ${m.suggestion}` };
}

export { screenBrief } from "./brief";
export { checkVerbatimOverlap, makeReference, shinglesOf } from "./verbatim";
export type { RightsVerdict } from "./brief";
export type { Reference } from "./verbatim";
