import { describe, expect, it } from "vitest";

import { safeNext } from "../lib/auth/safe-next";

describe("safeNext", () => {
  it("keeps same-origin paths, query included", () => {
    expect(safeNext("/station")).toBe("/station");
    expect(safeNext("/songs/new?x=1")).toBe("/songs/new?x=1");
  });
  it("falls back for anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", null, undefined, "/a\nb"]) {
      expect(safeNext(bad)).toBe("/library");
    }
  });
  it("uses a custom fallback", () => {
    expect(safeNext("x", "/station")).toBe("/station");
  });
});
