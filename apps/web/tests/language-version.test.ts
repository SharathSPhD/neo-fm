import { describe, expect, it } from "vitest";

import { CreateSongRequestSchema } from "../lib/api/song-schemas";
import {
  availableTargets,
  buildVersionBrief,
  clipText,
  groupIdFor,
  MAX_VERSION_BRIEF_CHARS,
  styleForVersion,
} from "../lib/song/language-version";

describe("availableTargets", () => {
  it("excludes the source language and languages siblings already cover", () => {
    expect(availableTargets("hi")).toEqual(["kn", "ta", "te", "bn"]);
    expect(availableTargets("en")).toEqual(["hi", "kn", "ta", "te", "bn"]);
    expect(availableTargets("hi", ["ta", "bn"])).toEqual(["kn", "te"]);
    expect(availableTargets("hi", ["kn", "ta", "te", "bn"])).toEqual([]);
  });
});

describe("styleForVersion", () => {
  it("keeps portable styles", () => {
    expect(styleForVersion("western", "ta")).toBe("western");
    expect(styleForVersion("carnatic", "bn")).toBe("carnatic");
    expect(styleForVersion("hindustani", "kn")).toBe("hindustani");
  });
  it("moves language-bound styles to the target's native style", () => {
    expect(styleForVersion("tamil-folk", "bn")).toBe("bengali-rabindrasangeet");
    expect(styleForVersion("bollywood-ballad", "te")).toBe("telugu-keerthana");
    expect(styleForVersion("kannada-folk", "hi")).toBe("bollywood-ballad");
  });
  it("only ever yields real style families", () => {
    const real = new Set([
      "western", "carnatic", "hindustani", "kannada-folk", "kannada-light-classical",
      "tamil-folk", "bollywood-ballad", "sanskrit-shloka", "bengali-rabindrasangeet", "telugu-keerthana",
    ]);
    for (const t of ["hi", "kn", "ta", "te", "bn"] as const) {
      for (const s of real) expect(real.has(styleForVersion(s, t))).toBe(true);
    }
  });
});

describe("buildVersionBrief", () => {
  const base = { title: "Barsaat ki Raat", sourceLanguage: "hi", targetLanguage: "ta" as const, sourceStyle: "hindustani" };

  it("names the target language, theme/mood carry-over and asks for fresh lyrics", () => {
    const b = buildVersionBrief(base);
    expect(b).toContain("Tamil version");
    expect(b).toContain("Barsaat ki Raat");
    expect(b).toContain("same theme, mood and imagery");
    expect(b).toContain("not a line-by-line translation");
  });

  it("includes the original brief only when given", () => {
    expect(buildVersionBrief(base)).not.toContain("Original brief");
    expect(buildVersionBrief({ ...base, originalBrief: "monsoon longing  at a window" })).toContain(
      "Original brief: monsoon longing at a window",
    );
  });

  it("stays within the limit even for huge inputs", () => {
    const b = buildVersionBrief({ ...base, title: "T".repeat(500), originalBrief: "word ".repeat(500) });
    expect(Array.from(b).length).toBeLessThanOrEqual(MAX_VERSION_BRIEF_CHARS + 1);
  });

  it("handles Indic titles", () => {
    expect(buildVersionBrief({ ...base, title: "बरसात की रात", targetLanguage: "bn" })).toContain("बरसात की रात");
  });
});

describe("clipText", () => {
  it("collapses whitespace and clips on a word boundary", () => {
    expect(clipText("a   b\n c", 50)).toBe("a b c");
    expect(clipText("alpha beta gamma delta", 14)).toBe("alpha beta…");
  });
});

describe("groupIdFor", () => {
  it("uses the parent's group when it has one, else the parent itself", () => {
    expect(groupIdFor({ id: "p", version_group: "g" })).toBe("g");
    expect(groupIdFor({ id: "p", version_group: null })).toBe("p");
    expect(groupIdFor({ id: "p" })).toBe("p");
  });
});

describe("CreateSongRequestSchema version_of", () => {
  const prompt = { prompt: "x", language: "ta", style_family: "western", target_duration_seconds: 60 };
  const id = "11111111-1111-4111-8111-111111111111";
  it("accepts a uuid with the prompt branch", () => {
    expect(CreateSongRequestSchema.safeParse({ ...prompt, version_of: id }).success).toBe(true);
  });
  it("rejects a non-uuid", () => {
    expect(CreateSongRequestSchema.safeParse({ ...prompt, version_of: "nope" }).success).toBe(false);
  });
  it("rejects it without a prompt", () => {
    const doc = {
      language: "en", style_family: "western", target_duration_seconds: 30,
      sections: [{ id: "v", type: "verse" }],
    };
    expect(CreateSongRequestSchema.safeParse({ song_document: doc, version_of: id }).success).toBe(false);
  });
});
