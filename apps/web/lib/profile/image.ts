/**
 * Avatar upload checks and metadata stripping, with no native dependencies.
 *
 * We never trust the client's content-type: the format is sniffed from magic bytes, dimensions are
 * read from the header, and EXIF/XMP (which can carry GPS and device data) is removed. Pixels are
 * not re-encoded. SVG and GIF are rejected outright.
 */

export type AvatarFormat = "png" | "jpeg" | "webp";

export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_MIN_PX = 64;
export const AVATAR_MAX_PX = 4096;

export const AVATAR_MIME: Record<AvatarFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export type AvatarCheck =
  | { ok: true; format: AvatarFormat; width: number; height: number; bytes: Uint8Array }
  | { ok: false; error: "too_large" | "unsupported_type" | "corrupt" | "too_small" | "too_big_dimensions" };

export function sniffFormat(b: Uint8Array): AvatarFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

export function checkAvatar(input: Uint8Array): AvatarCheck {
  if (input.length > AVATAR_MAX_BYTES) return { ok: false, error: "too_large" };
  const format = sniffFormat(input);
  if (!format) return { ok: false, error: "unsupported_type" };
  let parsed: { width: number; height: number; bytes: Uint8Array } | null;
  try {
    parsed = format === "png" ? stripPng(input) : format === "jpeg" ? stripJpeg(input) : stripWebp(input);
  } catch {
    parsed = null;
  }
  if (!parsed) return { ok: false, error: "corrupt" };
  const { width, height } = parsed;
  if (width < AVATAR_MIN_PX || height < AVATAR_MIN_PX) return { ok: false, error: "too_small" };
  if (width > AVATAR_MAX_PX || height > AVATAR_MAX_PX) return { ok: false, error: "too_big_dimensions" };
  return { ok: true, format, width, height, bytes: parsed.bytes };
}

function ascii(b: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i]!);
  return s;
}
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// PNG: keep critical chunks plus the few ancillary ones that affect rendering; drop text/exif/time chunks.
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "pHYs", "acTL", "fcTL", "fdAT"]);

function stripPng(b: Uint8Array) {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let o = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIend = false;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, o + 8);
    const end = o + 12 + len;
    if (end > b.length) return null;
    if (type === "IHDR") {
      if (len !== 13) return null;
      width = u32be(b, o + 8);
      height = u32be(b, o + 12);
      sawIhdr = true;
    }
    if (PNG_KEEP.has(type)) parts.push(b.subarray(o, end));
    o = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIhdr || !sawIend) return null;
  return { width, height, bytes: concat(parts) };
}

// JPEG: drop APP1..APP15 (EXIF, XMP, vendor data) and comments; keep APP0 (JFIF) and APP2 (ICC profile).
function stripJpeg(b: Uint8Array) {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let o = 2;
  let width = 0;
  let height = 0;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded data up to EOI; copy as-is.
      if (!width) return null;
      parts.push(b.subarray(o));
      return { width, height, bytes: concat(parts) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      height = u16be(b, o + 5);
      width = u16be(b, o + 7);
    }
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2) || marker === 0xfe;
    if (!drop) parts.push(b.subarray(o, o + 2 + len));
    o += 2 + len;
  }
  return null;
}

// WebP (RIFF): drop EXIF and XMP chunks and clear their flags in VP8X.
function stripWebp(b: Uint8Array) {
  const riffSize = u32le(b, 4);
  if (riffSize + 8 > b.length) return null;
  const chunks: Uint8Array[] = [];
  let o = 12;
  let width = 0;
  let height = 0;
  while (o + 8 <= riffSize + 8) {
    const type = ascii(b, o, o + 4);
    const len = u32le(b, o + 4);
    const padded = len + (len & 1);
    if (o + 8 + len > b.length) return null;
    const body = b.subarray(o + 8, o + 8 + len);
    if (type === "VP8X") {
      if (len < 10) return null;
      width = u24le(b, o + 12) + 1;
      height = u24le(b, o + 15) + 1;
      const fixed = new Uint8Array(8 + padded);
      fixed.set(b.subarray(o, o + 8 + padded));
      fixed[8] = fixed[8]! & ~(0x08 | 0x04); // clear EXIF (0x08) and XMP (0x04) flags
      chunks.push(fixed);
    } else if (type === "EXIF" || type === "XMP ") {
      // dropped
    } else {
      if (type === "VP8 " && !width && len >= 10) {
        width = (body[6]! | (body[7]! << 8)) & 0x3fff;
        height = (body[8]! | (body[9]! << 8)) & 0x3fff;
      } else if (type === "VP8L" && !width && len >= 5) {
        const bits = body[1]! | (body[2]! << 8) | (body[3]! << 16) | (body[4]! << 24);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      chunks.push(b.subarray(o, o + 8 + padded));
    }
    o += 8 + padded;
  }
  if (!width || !height) return null;
  const payload = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4), 0);
  const size = payload.length + 4;
  header[4] = size & 0xff;
  header[5] = (size >>> 8) & 0xff;
  header[6] = (size >>> 16) & 0xff;
  header[7] = (size >>> 24) & 0xff;
  header.set(b.subarray(8, 12), 8);
  return { width, height, bytes: concat([header, payload]) };
}
