/**
 * Cover-art template renderer (v1.4 Sprint 1).
 *
 * Renders a deterministic SVG cover for a song without a GPU or a queue.
 * The image looks intentionally hand-crafted: a radial-ish gradient
 * mirroring `coverGradient()` from `components/cover-art.tsx`, plus a
 * large title glyph (first grapheme of the title) and a subtle musical
 * note in the corner. The same (jobId, styleFamily, title) tuple always
 * produces the same SVG bytes — important so realtime UI updates don't
 * flash a different cover.
 *
 * Why SVG and not PNG: Supabase Storage serves SVG natively at
 * `image/svg+xml`; the entire payload is under 4 KB; and we avoid a
 * heavy raster encoder dependency on the edge. Browsers happily display
 * 1024×1024 SVG covers.
 *
 * The renderer is pure and side-effect-free, suitable for both the API
 * route and tests.
 */

import { coverGradient } from "@/components/cover-art";

const STYLE_HUE: Record<string, number> = {
  carnatic: 24,
  hindustani: 215,
  "kannada-folk": 45,
  "kannada-light-classical": 320,
  "tamil-folk": 8,
  "bollywood-ballad": 280,
  "sanskrit-shloka": 50,
  "bengali-rabindrasangeet": 180,
  "telugu-keerthana": 30,
  western: 210,
};

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  }
  return h;
}

function pickHues(jobId: string, styleFamily: string | null): [number, number] {
  const base = STYLE_HUE[styleFamily ?? ""] ?? 280;
  const h = hashSeed(jobId);
  const hueA = (base + (h % 28) - 14 + 360) % 360;
  const hueB = (hueA + 35 + ((h >> 8) % 25)) % 360;
  return [hueA, hueB];
}

interface SegmenterCtor {
  new (
    locales?: string | string[],
    options?: { granularity?: "grapheme" | "word" | "sentence" },
  ): {
    segment(input: string): Iterable<{ segment: string }>;
  };
}

/** Grab the first user-perceived character of a title. */
function firstGlyph(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "♪";
  // The Intl.Segmenter path covers Indic conjuncts (Devanagari, Tamil,
  // Kannada, Bengali) where a "character" spans multiple code points.
  // We fall back to a codepoint slice for older runtimes.
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Seg === "function") {
    const seg = new Seg(undefined, { granularity: "grapheme" });
    const first = seg.segment(trimmed)[Symbol.iterator]().next();
    return first.value?.segment ?? trimmed[0]!;
  }
  return Array.from(trimmed)[0] ?? "♪";
}

function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface RenderCoverArtSvgArgs {
  jobId: string;
  title: string;
  styleFamily: string | null;
  size?: number;
}

/** Render the deterministic cover-art SVG. */
export function renderCoverArtSvg(args: RenderCoverArtSvgArgs): string {
  const { jobId, title, styleFamily, size = 1024 } = args;
  const [hueA, hueB] = pickHues(jobId, styleFamily);
  const glyph = escapeSvgText(firstGlyph(title));
  const styleLabel = escapeSvgText(styleFamily ?? "");
  const h = hashSeed(jobId);
  // Two soft white dots painted off-centre for a hint of texture.
  const dotX = 0.15 + ((h % 50) / 100);
  const dotY = 0.18 + ((h >> 5) % 50) / 100;
  const dotR = 0.32 + ((h >> 10) % 20) / 100;

  // The font fallback chain prioritises modern sans-serif fonts shipped on
  // most operating systems so Indic glyphs render at full size.
  const fontStack =
    "'Inter','Segoe UI','Helvetica Neue','Noto Sans','Noto Sans Devanagari','Noto Sans Tamil','Noto Sans Kannada','Noto Sans Bengali','Noto Sans Telugu','Mukta','Arial',sans-serif";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Cover art for ${escapeSvgText(title)}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hueA}, 55%, 32%)"/>
      <stop offset="100%" stop-color="hsl(${hueB}, 60%, 18%)"/>
    </linearGradient>
    <radialGradient id="dot" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
      <stop offset="0%" stop-color="hsl(${(hueA + 30) % 360}, 65%, 70%)" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="hsl(${hueA}, 65%, 30%)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <circle cx="${(dotX * size).toFixed(1)}" cy="${(dotY * size).toFixed(1)}" r="${(dotR * size).toFixed(1)}" fill="url(#dot)"/>
  <circle cx="${((1 - dotX) * size).toFixed(1)}" cy="${((1 - dotY) * size).toFixed(1)}" r="${(dotR * 0.6 * size).toFixed(1)}" fill="url(#dot)" opacity="0.55"/>
  <g font-family="${fontStack}" fill="white" text-anchor="middle">
    <text x="${size / 2}" y="${size * 0.6}" font-size="${size * 0.55}" font-weight="600" opacity="0.92">${glyph}</text>
    ${styleLabel
      ? `<text x="${size / 2}" y="${size * 0.92}" font-size="${size * 0.04}" letter-spacing="${size * 0.005}" opacity="0.55" text-transform="uppercase">${styleLabel}</text>`
      : ""}
  </g>
  <text x="${size * 0.92}" y="${size * 0.93}" font-size="${size * 0.05}" fill="white" opacity="0.45" text-anchor="end" font-family="${fontStack}">&#9834;</text>
</svg>`;
}

/** Stable storage path for a given attempt. */
export function templateStoragePath(
  userId: string,
  jobId: string,
  attemptId: string,
): string {
  return `${userId}/${jobId}/${attemptId}.svg`;
}

/** Compose the SVG body and helper bytes for upload. */
export function renderTemplate(args: {
  jobId: string;
  title: string;
  styleFamily: string | null;
  size?: number;
}): { svg: string; bytes: Uint8Array; contentType: string } {
  const svg = renderCoverArtSvg(args);
  return {
    svg,
    bytes: new TextEncoder().encode(svg),
    contentType: "image/svg+xml",
  };
}

// Re-export coverGradient so call sites that want the CSS fallback can
// pull both from one module if convenient.
export { coverGradient };
