import type { Platform } from "../config";

export interface ShareTarget {
  platform: Platform | "whatsapp";
  /** Opens in a new tab or app; no account connection or API needed. */
  href: string | null;
  /** True when the platform has no web intent and the user finishes in its app (copy the text, then open). */
  copyThenOpen: boolean;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

/**
 * Fallback that always works, signed in or not: the platforms' own web intents and app links. Only Facebook and
 * WhatsApp accept a link plus text from the web; YouTube, TikTok and Instagram have no web compose intent for audio,
 * so those open the app/site and the caller copies the caption first.
 */
export function shareTargets(url: string, text: string): ShareTarget[] {
  return [
    { platform: "whatsapp", href: `https://wa.me/?${q({ text: `${text} ${url}` })}`, copyThenOpen: false },
    { platform: "facebook", href: `https://www.facebook.com/sharer/sharer.php?${q({ u: url, quote: text })}`, copyThenOpen: false },
    { platform: "instagram", href: "https://www.instagram.com/", copyThenOpen: true },
    { platform: "tiktok", href: "https://www.tiktok.com/upload", copyThenOpen: true },
    { platform: "youtube", href: "https://studio.youtube.com/", copyThenOpen: true },
  ];
}
