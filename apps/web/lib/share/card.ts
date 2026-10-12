/**
 * Pure helpers for the share card (OG image) and native share button.
 * Pure and client-safe (imported by the share button); server-side
 * font/shaping work lives in ./shape.ts.
 */

export interface CardSection {
  type?: string;
  lyrics?: string;
  script?: string;
}

export type CardFontScript =
  | "devanagari"
  | "tamil"
  | "telugu"
  | "kannada"
  | "bengali"
  | "latin";

/**
 * Per-script kill switch for the lyric excerpt on the card. Flip a
 * script to false to ship the title-only card for it (e.g. if shaping
 * regresses); Latin is always on.
 */
export const EXCERPT_SCRIPTS_ENABLED: Record<CardFontScript, boolean> = {
  devanagari: true,
  bengali: true,
  tamil: true,
  telugu: true,
  kannada: true,
  latin: true,
};

const SCRIPT_RANGES: [CardFontScript, RegExp][] = [
  ["devanagari", /[ऀ-ॿ]/],
  ["bengali", /[ঀ-৿]/],
  ["tamil", /[஀-௿]/],
  ["telugu", /[ఀ-౿]/],
  ["kannada", /[ಀ-೿]/],
];

export function detectScript(text: string): CardFontScript {
  for (const [name, re] of SCRIPT_RANGES) if (re.test(text)) return name;
  return "latin";
}

export const SCRIPT_FILE: Record<Exclude<CardFontScript, "latin">, string> = {
  devanagari: "Devanagari",
  bengali: "Bengali",
  tamil: "Tamil",
  telugu: "Telugu",
  kannada: "Kannada",
};

export const FONT_FAMILY: Record<CardFontScript, string> = {
  devanagari: "Noto Sans Devanagari",
  bengali: "Noto Sans Bengali",
  tamil: "Noto Sans Tamil",
  telugu: "Noto Sans Telugu",
  kannada: "Noto Sans Kannada",
  latin: "Noto Sans",
};

/**
 * First two non-empty lyric lines, preferring a chorus/hook section.
 * Section markers like "[Chorus]" and blank lines are skipped. Each
 * line is clipped on a code-point boundary so we never split a
 * grapheme cluster's surrogate pair (cluster splits are avoided by
 * clipping at whitespace where possible).
 */
export function pickExcerpt(
  sections: CardSection[] | undefined,
  opts: { maxLines?: number; maxChars?: number } = {},
): string[] {
  const maxLines = opts.maxLines ?? 2;
  const maxChars = opts.maxChars ?? 44;
  if (!sections?.length) return [];
  const rank = (s: CardSection) =>
    /chorus|hook|pallavi|mukhda/i.test(s.type ?? "") ? 0 : 1;
  const ordered = sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i);
  for (const { s } of ordered) {
    const raw = (s.script?.trim() ? s.script : s.lyrics) ?? "";
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
    if (lines.length > 0) {
      return lines.slice(0, maxLines).map((l) => clip(l, maxChars));
    }
  }
  return [];
}

function clip(line: string, max: number): string {
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  const cut = chars.slice(0, max).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Deterministic pseudo-waveform: same song id => same silhouette. */
export function waveformBars(seed: string, count = 58): number[] {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const noise = (h >>> 8) / 0xffffff;
    // Envelope keeps the edges calm so it reads as a phrase, not static.
    const env = Math.sin((Math.PI * (i + 0.5)) / count);
    out.push(Math.round((0.2 + 0.8 * noise * (0.45 + 0.55 * env)) * 100) / 100);
  }
  return out;
}

export interface CardFont {
  name: string;
  data: ArrayBuffer;
  weight: 400;
  style: "normal";
}

export function fontFamilyFor(text: string): string {
  return FONT_FAMILY[detectScript(text)];
}

/** Payload for navigator.share; text kept short for messaging apps. */
export function buildSharePayload(title: string, url: string) {
  return { title, text: `Listen to “${title}” on neo-fm`, url };
}

/**
 * satori does no complex-script reordering, so pre-base vowel signs
 * (Devanagari ि, Bengali ি ে ৈ, Tamil ெ ே ை) render after the
 * consonant. Move them in front of the consonant cluster; glyphs then
 * land where a shaping engine would put them. Only for the OG image.
 */
const PRE_BASE: { cons: string; mark: string }[] = [
  { cons: "क-हक़-य़", mark: "ि" },
  { cons: "ক-হড়-য়", mark: "িেৈ" },
  { cons: "க-ஹ", mark: "ெேை" },
];

export function reorderForSatori(text: string): string {
  // Split two-part vowel signs so the pre-base half can move; fold the
  // Bengali ya+nukta pair into its precomposed letter.
  let out = text
    .replace(/([\u0B95-\u0BB9])\u0BCA/g, "\u0BC6$1\u0BBE")
    .replace(/([\u0B95-\u0BB9])\u0BCB/g, "\u0BC7$1\u0BBE")
    .replace(/([\u0B95-\u0BB9])\u0BCC/g, "\u0BC6$1\u0BD7")
    .replace(/([\u0995-\u09B9])\u09CB/g, "\u09C7$1\u09BE")
    .replace(/([\u0995-\u09B9])\u09CC/g, "\u09C7$1\u09D7")
    .replace(/\u09AF\u09BC/g, "\u09DF");
  for (const { cons, mark } of PRE_BASE) {
    const virama = cons.startsWith("क")
      ? "्"
      : cons.startsWith("ক")
        ? "্"
        : "்";
    const re = new RegExp(
      `((?:[${cons}][\\u093C\\u09BC]?${virama})*[${cons}][\\u093C\\u09BC]?)([${mark}])`,
      "g",
    );
    out = out.replace(re, "$2$1");
  }
  return out;
}
