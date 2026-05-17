/**
 * Unit tests for `lib/cover-art-template`.
 *
 * The renderer is pure (no FS, no network, no GPU), so we can assert
 * determinism and structural invariants without spinning up a Storage
 * mock.
 */
import { describe, expect, it } from "vitest";

import {
  renderCoverArtSvg,
  renderTemplate,
  templateStoragePath,
} from "../../lib/cover-art-template";

describe("renderCoverArtSvg", () => {
  it("returns a well-formed SVG document", () => {
    const svg = renderCoverArtSvg({
      jobId: "11111111-1111-1111-1111-111111111111",
      title: "Sample title",
      styleFamily: "carnatic",
    });
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("</svg>");
    expect(svg).toContain('viewBox="0 0 1024 1024"');
  });

  it("is deterministic for the same inputs", () => {
    const a = renderCoverArtSvg({
      jobId: "22222222-2222-2222-2222-222222222222",
      title: "Hello",
      styleFamily: "hindustani",
    });
    const b = renderCoverArtSvg({
      jobId: "22222222-2222-2222-2222-222222222222",
      title: "Hello",
      styleFamily: "hindustani",
    });
    expect(a).toBe(b);
  });

  it("changes when the jobId changes", () => {
    const a = renderCoverArtSvg({
      jobId: "33333333-3333-3333-3333-333333333333",
      title: "Same",
      styleFamily: "carnatic",
    });
    const b = renderCoverArtSvg({
      jobId: "44444444-4444-4444-4444-444444444444",
      title: "Same",
      styleFamily: "carnatic",
    });
    expect(a).not.toBe(b);
  });

  it("embeds the first grapheme of the title", () => {
    const svg = renderCoverArtSvg({
      jobId: "55555555-5555-5555-5555-555555555555",
      title: "Bhavageete forever",
      styleFamily: "kannada-light-classical",
    });
    expect(svg).toMatch(/>B</);
  });

  it("handles Devanagari titles", () => {
    const svg = renderCoverArtSvg({
      jobId: "66666666-6666-6666-6666-666666666666",
      title: "अनुपम",
      styleFamily: "hindustani",
    });
    // First grapheme of "अनुपम" is the conjunct अ (single code-point
    // here; the conjunct test runs in the next case).
    expect(svg).toMatch(/>अ</);
  });

  it("handles Tamil conjunct graphemes", () => {
    const svg = renderCoverArtSvg({
      jobId: "77777777-7777-7777-7777-777777777777",
      title: "தேனிசை",
      styleFamily: "tamil-folk",
    });
    expect(svg).toMatch(/>த[ே]?</);
  });

  it("falls back to a music glyph when title is blank", () => {
    const svg = renderCoverArtSvg({
      jobId: "88888888-8888-8888-8888-888888888888",
      title: "",
      styleFamily: null,
    });
    expect(svg).toMatch(/>♪</);
  });

  it("escapes special characters in title", () => {
    const svg = renderCoverArtSvg({
      jobId: "99999999-9999-9999-9999-999999999999",
      title: '<script>"&\'',
      styleFamily: "western",
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;");
  });

  it("respects custom size", () => {
    const svg = renderCoverArtSvg({
      jobId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      title: "x",
      styleFamily: null,
      size: 256,
    });
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('width="256"');
  });

  it("includes the style label when supplied", () => {
    const svg = renderCoverArtSvg({
      jobId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      title: "Test",
      styleFamily: "tamil-folk",
    });
    expect(svg).toContain("tamil-folk");
  });
});

describe("renderTemplate", () => {
  it("returns bytes matching the SVG", () => {
    const { svg, bytes, contentType } = renderTemplate({
      jobId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      title: "Bytes test",
      styleFamily: "carnatic",
    });
    expect(contentType).toBe("image/svg+xml");
    expect(new TextDecoder().decode(bytes)).toBe(svg);
    expect(bytes.byteLength).toBeGreaterThan(200);
    expect(bytes.byteLength).toBeLessThan(4096);
  });
});

describe("templateStoragePath", () => {
  it("is namespaced by user, song, attempt", () => {
    const p = templateStoragePath(
      "user-A",
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    );
    expect(p).toBe(
      "user-A/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.svg",
    );
  });
});
