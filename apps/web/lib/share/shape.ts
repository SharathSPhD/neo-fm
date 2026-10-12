/**
 * Shapes a line of Indic text with HarfBuzz and returns one SVG path.
 * satori has no complex-script shaping (conjuncts, reph, pre-base
 * vowel signs), so the OG card draws lyric lines as vector paths
 * instead of text. Returns null on any failure so callers can fall
 * back to plain text.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  detectScript,
  FONT_FAMILY,
  SCRIPT_FILE,
  type CardFont,
  type CardFontScript,
} from "./card";

export interface ShapedLine {
  width: number;
  height: number;
  /** SVG path in a viewBox of `0 0 width height`, y-down. */
  d: string;
}

const FILES: Record<Exclude<CardFontScript, "latin">, string> = {
  devanagari: "NotoSansDevanagari-Regular.ttf",
  bengali: "NotoSansBengali-Regular.ttf",
  tamil: "NotoSansTamil-Regular.ttf",
  telugu: "NotoSansTelugu-Regular.ttf",
  kannada: "NotoSansKannada-Regular.ttf",
};

const rawFontCache = new Map<string, ArrayBuffer>();

type Hb = typeof import("harfbuzzjs");
const fontCache = new Map<string, { font: InstanceType<Hb["Font"]>; upem: number }>();
let hbPromise: Promise<Hb> | null = null;

async function loadFont(file: string) {
  const hit = fontCache.get(file);
  if (hit) return hit;
  hbPromise ??= import("harfbuzzjs");
  const hb = await hbPromise;
  const bytes = await readFile(join(process.cwd(), "lib/share/fonts", file));
  const face = new hb.Face(new hb.Blob(bytes));
  const font = new hb.Font(face);
  const entry = { font, upem: face.upem };
  fontCache.set(file, entry);
  return entry;
}

export async function shapeLine(
  text: string,
  fontSize: number,
): Promise<ShapedLine | null> {
  const script = detectScript(text);
  if (script === "latin") return null;
  try {
    const hb = await (hbPromise ??= import("harfbuzzjs"));
    const { font, upem } = await loadFont(FILES[script]);
    const buf = new hb.Buffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    hb.shape(font, buf);
    const infos = buf.getGlyphInfos();
    const pos = buf.getGlyphPositions();
    const k = fontSize / upem;
    let x = 0;
    const parts: string[] = [];
    infos.forEach((info, i) => {
      const p = pos[i]!;
      const path = font.glyphToPath(info.codepoint);
      if (path) {
        // Font units are y-up; flip and place on a baseline at 0.82em.
        parts.push(
          transformPath(path, k, x + p.xOffset * k, fontSize * 0.82 - p.yOffset * k),
        );
      }
      x += p.xAdvance * k;
    });
    return { width: Math.ceil(x), height: Math.ceil(fontSize * 1.3), d: parts.join(" ") };
  } catch (e) {
    if (process.env.SHAPE_DEBUG) console.error(e);
    return null;
  }
}

/** Scales, flips and translates an absolute SVG path (M L Q C Z). */
function transformPath(d: string, k: number, dx: number, dy: number): string {
  return d.replace(/([MLQCZ])([^MLQCZ]*)/g, (_, cmd: string, args: string) => {
    if (cmd === "Z") return "Z";
    const nums = args.trim().split(/[\s,]+/).map(Number);
    const out: string[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      out.push(
        `${(dx + nums[i]! * k).toFixed(2)} ${(dy - nums[i + 1]! * k).toFixed(2)}`,
      );
    }
    return `${cmd}${out.join(" ")}`;
  });
}

/**
 * Loads the bundled Noto face for the text's script (OFL, see
 * ./fonts/OFL.txt). Latin needs nothing: next/og ships its own. Bundled
 * rather than fetched so cards render offline and never wait on a
 * third party. Returns [] if the file can't be read.
 */
export async function loadFontsFor(text: string): Promise<CardFont[]> {
  const script = detectScript(text);
  if (script === "latin") return [];
  const file = `NotoSans${SCRIPT_FILE[script]}-Regular.ttf`;
  try {
    let data = rawFontCache.get(file);
    if (!data) {
      const buf = await readFile(join(process.cwd(), "lib/share/fonts", file));
      data = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
      rawFontCache.set(file, data);
    }
    return [{ name: FONT_FAMILY[script], data, weight: 400, style: "normal" }];
  } catch {
    return [];
  }
}

