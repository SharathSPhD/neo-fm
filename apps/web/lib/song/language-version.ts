/**
 * "Make it in another language": pure helpers shared by the dialog (client)
 * and the tests. A new-language version is a brand-new song generated through
 * the normal create-song API (so quotas and moderation apply); this module
 * only decides what to pre-fill.
 */
import { prettyLanguage, prettyStyle } from "./labels";

export const VERSION_LANGUAGES = ["hi", "kn", "ta", "te", "bn"] as const;
export type VersionLanguage = (typeof VERSION_LANGUAGES)[number];

/** Style families that are not tied to one language and carry over unchanged. */
const PORTABLE_STYLES = new Set(["western", "carnatic", "hindustani"]);

const NATIVE_STYLE: Record<VersionLanguage, string> = {
  hi: "bollywood-ballad",
  kn: "kannada-light-classical",
  ta: "tamil-folk",
  te: "telugu-keerthana",
  bn: "bengali-rabindrasangeet",
};

export const MAX_ORIGINAL_BRIEF_CHARS = 280;
export const MAX_VERSION_BRIEF_CHARS = 600;

export function isVersionLanguage(l: string): l is VersionLanguage {
  return (VERSION_LANGUAGES as readonly string[]).includes(l);
}

/** Languages a song can still be remade in: not its own, not one a sibling already covers. */
export function availableTargets(
  sourceLanguage: string,
  existingLanguages: readonly string[] = [],
): VersionLanguage[] {
  const taken = new Set([sourceLanguage, ...existingLanguages]);
  return VERSION_LANGUAGES.filter((l) => !taken.has(l));
}

/**
 * Style for the new version. Portable styles (western, carnatic, hindustani)
 * stay; a language-bound style (e.g. Tamil folk) moves to the target
 * language's native style so a Bengali version doesn't ask for a Tamil
 * folk arrangement.
 */
export function styleForVersion(sourceStyle: string, target: VersionLanguage): string {
  return PORTABLE_STYLES.has(sourceStyle) ? sourceStyle : NATIVE_STYLE[target];
}

/** Collapse whitespace and cut at a word boundary so a long original brief can't flood the new one. */
export function clipText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (Array.from(t).length <= max) return t;
  const cut = Array.from(t).slice(0, max).join("");
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}

/**
 * Brief for the new version. Carries the original's theme and mood (its own
 * brief when we may show it, else just title and style) and asks for fresh
 * lyrics in the target language rather than a line-by-line translation.
 */
export function buildVersionBrief(opts: {
  title: string;
  sourceLanguage: string;
  targetLanguage: VersionLanguage;
  sourceStyle: string;
  originalBrief?: string | null;
}): string {
  const target = prettyLanguage(opts.targetLanguage);
  const parts = [
    `A ${target} version of "${clipText(opts.title, 60) || "this song"}", originally ${prettyLanguage(opts.sourceLanguage)} (${prettyStyle(opts.sourceStyle)}).`,
    "Keep the same theme, mood and imagery.",
  ];
  const brief = opts.originalBrief ? clipText(opts.originalBrief, MAX_ORIGINAL_BRIEF_CHARS) : "";
  if (brief) parts.push(`Original brief: ${brief}`);
  parts.push(`Write fresh ${target} lyrics in a natural poetic voice, not a line-by-line translation.`);
  return clipText(parts.join(" "), MAX_VERSION_BRIEF_CHARS);
}

export interface VersionSibling {
  id: string;
  language: string;
  title: string | null;
  status: string;
  publicId: string | null;
  /** Viewer owns it (links to the owner page rather than the public one). */
  owned: boolean;
}

/** Group id for a new version of `parent`: reuse the parent's group so all versions share one. */
export function groupIdFor(parent: { id: string; version_group?: string | null }): string {
  return parent.version_group ?? parent.id;
}
