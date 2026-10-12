import { describe, expect, it } from "vitest";

import { buildOembed, publicIdFromUrl } from "@/lib/embed/oembed";
import {
  EMBED_HEIGHT,
  clampWidth,
  embedIframeHtml,
  embedPath,
  parseEmbedOptions,
} from "@/lib/embed/options";

describe("parseEmbedOptions", () => {
  it("defaults to full/auto", () => {
    expect(parseEmbedOptions({})).toEqual({ layout: "full", theme: "auto" });
  });
  it("accepts known values and ignores junk", () => {
    expect(parseEmbedOptions({ layout: "compact", theme: "dark" })).toEqual({ layout: "compact", theme: "dark" });
    expect(parseEmbedOptions({ layout: "huge", theme: ["light", "dark"] })).toEqual({ layout: "full", theme: "light" });
    expect(parseEmbedOptions(new URLSearchParams("theme=neon"))).toEqual({ layout: "full", theme: "auto" });
  });
});

describe("embed snippet", () => {
  it("omits default params from the path", () => {
    expect(embedPath("abcdefghjk", { layout: "full", theme: "auto" })).toBe("/s/abcdefghjk/embed");
    expect(embedPath("abcdefghjk", { layout: "compact", theme: "dark" })).toBe("/s/abcdefghjk/embed?layout=compact&theme=dark");
  });
  it("sizes the iframe for the layout and escapes the title", () => {
    const html = embedIframeHtml({
      origin: "https://x.test",
      publicId: "abcdefghjk",
      title: 'A "song" <b>',
      options: { layout: "compact", theme: "light" },
      width: 5000,
    });
    expect(html).toContain(`height="${EMBED_HEIGHT.compact}"`);
    expect(html).toContain('width="1200"');
    expect(html).toContain("layout=compact&theme=light");
    expect(html).not.toMatch(/title="[^"]*[<>]/);
    expect(html).toContain('title="A song b"');
  });
  it("is fluid without a width", () => {
    expect(embedIframeHtml({ origin: "", publicId: "abcdefghjk", options: { layout: "full", theme: "auto" } })).toContain('width="100%"');
    expect(clampWidth(10)).toBe(240);
    expect(clampWidth(NaN)).toBeNull();
  });
});

describe("oEmbed", () => {
  it("extracts ids only from song URLs on the allowed host", () => {
    expect(publicIdFromUrl("https://x.test/s/abcdefghjk", "x.test")).toBe("abcdefghjk");
    expect(publicIdFromUrl("https://x.test/s/abcdefghjk/embed?theme=dark", "x.test")).toBe("abcdefghjk");
    expect(publicIdFromUrl("https://evil.test/s/abcdefghjk", "x.test")).toBeNull();
    expect(publicIdFromUrl("https://x.test/s/ABC", "x.test")).toBeNull();
    expect(publicIdFromUrl("javascript:alert(1)")).toBeNull();
    expect(publicIdFromUrl("nonsense")).toBeNull();
  });
  it("builds a rich response and shrinks to compact when maxheight is small", () => {
    const full = buildOembed({ origin: "https://x.test", publicId: "abcdefghjk", title: "T" });
    expect(full.type).toBe("rich");
    expect(full.height).toBe(EMBED_HEIGHT.full);
    expect(full.thumbnail_url).toBe("https://x.test/s/abcdefghjk/opengraph-image");
    const small = buildOembed({ origin: "https://x.test", publicId: "abcdefghjk", title: "T", maxheight: 120, maxwidth: 300 });
    expect(small.height).toBe(EMBED_HEIGHT.compact);
    expect(small.width).toBe(300);
    expect(small.html).toContain("layout=compact");
  });
});
