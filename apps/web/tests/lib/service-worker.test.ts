import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("service worker privacy", () => {
  it("does not precache or runtime-cache signed-in pages", () => {
    const shell = /const SHELL_ROUTES = \[([\s\S]*?)\];/.exec(sw)![1]!;
    expect(shell).not.toContain('"/library"');
    expect(shell).not.toContain("/songs");
    const pages = /CACHEABLE_PAGES = new Set\(\[([\s\S]*?)\]\)/.exec(sw)![1]!;
    expect(pages).not.toMatch(/library|songs|account/);
  });
  it("never answers API requests from cache and skips signed storage URLs", () => {
    expect(sw).toContain('url.pathname.startsWith("/api/")');
    expect(sw).toContain("isSupabaseStorage");
  });
  it("leaves media and cross-origin requests to the browser (R2 pool audio failed through respondWith)", () => {
    expect(sw).toMatch(/req\.destination === "audio"/);
    expect(sw).toMatch(/req\.headers\.has\("range"\)/);
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/);
    // The bypass must come before every respondWith.
    expect(sw.indexOf('req.destination === "audio"')).toBeLessThan(sw.indexOf("event.respondWith"));
  });
});
