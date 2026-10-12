import { describe, expect, it } from "vitest";

import { buildPrompt } from "../lib/agent/lyria";

describe("lyria prompt", () => {
  it("adds an explicit length instruction for full renders", () => {
    expect(buildPrompt("Hindi folk", "[Verse]\nla", 60, "full")).toMatch(/^Duration: exactly 60 seconds total/);
  });
  it("leaves clips and unspecified lengths alone", () => {
    expect(buildPrompt("Hindi folk", "x", 30, "clip")).toBe("Hindi folk\n\nLyrics:\nx");
    expect(buildPrompt("Hindi folk", "x")).toBe("Hindi folk\n\nLyrics:\nx");
  });
});
