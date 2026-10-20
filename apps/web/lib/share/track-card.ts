/**
 * What the OG card of a station track (/t/[id]) says. satori cannot shape Indic scripts, so a native-script title goes
 * through the shaped excerpt lines instead of the Latin title slot (otherwise it renders as empty boxes); a Latin title
 * keeps the big slot and gets the language's own name as the shaped line, so a link in a regional language previews in it.
 */
import { LANGUAGE_PAGES } from "../seo/language-pages";
import { prettyLanguage } from "../song/labels";
import { detectScript } from "./card";

export interface TrackCardContent {
  title: string;
  subtitle: string;
  excerpt: string[];
  footer: [string, string];
}

/** The shaped line is drawn at 40px in a 1056px column; keep it to what fits on one line. */
const MAX_NATIVE_CHARS = 24;

function clip(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length > MAX_NATIVE_CHARS ? `${chars.slice(0, MAX_NATIVE_CHARS - 1).join("")}…` : chars.join("");
}

export function trackCardContent(track: { title: string; language: string }): TrackCardContent {
  const language = prettyLanguage(track.language);
  const native = LANGUAGE_PAGES.find((p) => p.code === track.language)?.native;
  const footer: [string, string] = ["AI-made, never cloned", "neo-fm: your personal FM"];
  if (detectScript(track.title) !== "latin") {
    return { title: `${language} song`, subtitle: "AI-made music on neo-fm", excerpt: [clip(track.title)], footer };
  }
  return {
    title: track.title,
    subtitle: `AI-made ${language} music on neo-fm`,
    excerpt: native ? [native] : [],
    footer,
  };
}
