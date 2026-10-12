import { describe, expect, it } from "vitest";

import { moderateAvatar } from "@/lib/profile/avatar-moderation";
import { BIO_MAX_CHARS, normalizeBio } from "@/lib/profile/bio";
import { AVATAR_MAX_BYTES, checkAvatar, sniffFormat } from "@/lib/profile/image";

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

function pngChunk(type: string, data: number[]) {
  return [...be32(data.length), ...text(type), ...data, 0, 0, 0, 0];
}
function png(w: number, h: number, extra: number[] = []) {
  const ihdr = [...be32(w), ...be32(h), 8, 2, 0, 0, 0];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", ihdr),
    ...extra,
    ...pngChunk("IDAT", [1, 2, 3]),
    ...pngChunk("IEND", []),
  ]);
}
function jpeg(w: number, h: number, withExif: boolean) {
  const exif = withExif ? [0xff, 0xe1, 0x00, 0x08, ...text("Exif"), 0, 0] : [];
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,
    ...exif,
    0xff, 0xc0, 0x00, 0x0b, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 1, 1, 0x11, 0,
    0xff, 0xda, 0x00, 0x02, 9, 9, 9,
    0xff, 0xd9,
  ]);
}
function webp(w: number, h: number) {
  const vp8x = [...text("VP8X"), ...le32(10), 0x0c, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)];
  const exif = [...text("EXIF"), ...le32(4), 1, 2, 3, 4];
  const vp8l = [...text("VP8L"), ...le32(2), 0, 0];
  const body = [...text("WEBP"), ...vp8x, ...exif, ...vp8l];
  return new Uint8Array([...text("RIFF"), ...le32(body.length), ...body]);
}
const contains = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle));

describe("normalizeBio", () => {
  it("clears on empty and trims", () => {
    expect(normalizeBio("   ")).toEqual({ ok: true, bio: null });
    expect(normalizeBio("  Hello  ")).toEqual({ ok: true, bio: "Hello" });
  });
  it("counts code points so Indic text is not penalised", () => {
    expect(normalizeBio("ಕ".repeat(BIO_MAX_CHARS)).ok).toBe(true);
    expect(normalizeBio("ಕ".repeat(BIO_MAX_CHARS + 1))).toEqual({ ok: false, error: "too_long" });
  });
  it("rejects links, bare domains and emails", () => {
    for (const bad of ["see https://x.test", "www.spam.com", "buy at shop.io now", "me@example.com"]) {
      expect(normalizeBio(bad)).toEqual({ ok: false, error: "links_not_allowed" });
    }
  });
  it("strips control and bidi override characters", () => {
    expect(normalizeBio("a‮b\u0007c")).toEqual({ ok: true, bio: "abc" });
  });
});

describe("checkAvatar", () => {
  it("sniffs formats from bytes, not names", () => {
    expect(sniffFormat(png(100, 100))).toBe("png");
    expect(sniffFormat(jpeg(100, 100, false))).toBe("jpeg");
    expect(sniffFormat(webp(100, 100))).toBe("webp");
    expect(sniffFormat(new Uint8Array(text("<svg xmlns=")))).toBeNull();
    expect(sniffFormat(new Uint8Array(text("GIF89a......")))).toBeNull();
  });
  it("accepts a png and drops text chunks", () => {
    const r = checkAvatar(png(128, 96, pngChunk("tEXt", text("GPS\0secret"))));
    expect(r.ok && [r.width, r.height]).toEqual([128, 96]);
    expect(r.ok && contains(r.bytes, "secret")).toBe(false);
  });
  it("accepts a jpeg and drops EXIF", () => {
    const r = checkAvatar(jpeg(200, 200, true));
    expect(r.ok && [r.width, r.height]).toEqual([200, 200]);
    expect(r.ok && contains(r.bytes, "Exif")).toBe(false);
  });
  it("accepts a webp, drops EXIF and clears its flag", () => {
    const r = checkAvatar(webp(300, 150));
    expect(r.ok && [r.width, r.height]).toEqual([300, 150]);
    expect(r.ok && contains(r.bytes, "EXIF")).toBe(false);
    expect(r.ok && (r.bytes[20]! & 0x08)).toBe(0);
  });
  it("rejects bad sizes, dimensions and corrupt files", () => {
    expect(checkAvatar(new Uint8Array(AVATAR_MAX_BYTES + 1))).toEqual({ ok: false, error: "too_large" });
    expect(checkAvatar(png(32, 32))).toEqual({ ok: false, error: "too_small" });
    expect(checkAvatar(png(5000, 100))).toEqual({ ok: false, error: "too_big_dimensions" });
    expect(checkAvatar(png(100, 100).subarray(0, 20))).toEqual({ ok: false, error: "corrupt" });
    expect(checkAvatar(new Uint8Array(text("not an image at all")))).toEqual({ ok: false, error: "unsupported_type" });
  });
});

describe("moderateAvatar", () => {
  const image = { mediaType: "image/png" as const, data: new Uint8Array([1, 2, 3]) };
  const client = (reply: () => Promise<unknown>) => ({ messages: { create: reply } }) as never;
  const ok = (t: string) => async () => ({ content: [{ type: "text", text: t }] });

  it("allows and rejects per the model verdict", async () => {
    expect(await moderateAvatar(client(ok('{"allowed":true,"reason":"fine"}')), image)).toEqual({ allowed: true });
    const no = await moderateAvatar(client(ok('{"allowed":false,"reason":"nudity"}')), image);
    expect(no).toEqual({ allowed: false, reason: "nudity" });
  });
  it("fails closed on errors and unparseable answers", async () => {
    const err = await moderateAvatar(client(async () => Promise.reject(new Error("down"))), image);
    expect(err.allowed).toBe(false);
    const junk = await moderateAvatar(client(ok("sure, looks fine")), image);
    expect(junk.allowed).toBe(false);
  });
});
