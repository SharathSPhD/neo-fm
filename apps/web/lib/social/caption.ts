import type { Platform } from "./config";

export interface TrackFacts {
  title: string | null;
  language: string;
  genre?: string | null;
  mood?: string[];
}

const LANG_NAME: Record<string, string> = { hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada", bn: "Bengali", en: "English", hinglish: "Hinglish", mr: "Marathi", ml: "Malayalam", pa: "Punjabi", gu: "Gujarati" };

/** Honest AI label, same wording on every platform; platforms' own flags are set in the adapters. */
export const AI_LABEL = "Made with AI: song, lyrics and visuals are AI-generated. No real artist's voice is used.";

export interface Post {
  title: string;
  caption: string;
  /** Needs a native-speaker read before any Indic copy goes public (see launch/indic-copy-review.md). */
  needsNativeRead: boolean;
}

/** Link back carries UTM so /admin/health shows which platform sent the listener. */
export function trackLink(base: string, platform: Platform, trackId: string): string {
  const u = new URL("/station", base);
  u.searchParams.set("utm_source", platform);
  u.searchParams.set("utm_medium", "video");
  u.searchParams.set("utm_campaign", "pool");
  u.searchParams.set("utm_content", trackId);
  return u.toString();
}

export function buildPost(t: TrackFacts, platform: Platform, trackId: string, base: string): Post {
  const lang = LANG_NAME[t.language] ?? t.language;
  const name = (t.title ?? "").trim() || `${lang} song`;
  const tags = ["#neofm", "#AIMusic", `#${lang}Songs`, ...(platform === "youtube" ? ["#Shorts"] : [])];
  const caption = [`${name} - a ${lang} song from your own radio that never stops.`, `Tune in: ${trackLink(base, platform, trackId)}`, AI_LABEL, tags.join(" ")].join("\n\n");
  return { title: `${name} | ${lang} | neo-fm`.slice(0, 100), caption, needsNativeRead: t.language !== "en" };
}
