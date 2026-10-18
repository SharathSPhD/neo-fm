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

describe("native prompt labels", () => {
  it("replaces the English label and duration line without touching the default path", async () => {
    const { NATIVE_LABELS } = await import("../lib/agent/lyria-native");
    const p = buildPrompt("x", "y", 60, "full", NATIVE_LABELS.ta);
    expect(p).toContain("வினாடிகள்");
    expect(p).toContain("பாடல் வரிகள்:");
    expect(p).not.toContain("Lyrics:");
    expect(p).not.toContain("Duration:");
    expect(buildPrompt("x", "y")).toBe("x\n\nLyrics:\ny");
  });
});
