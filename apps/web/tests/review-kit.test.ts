import { describe, expect, it } from "vitest";
import { hashToken, isWellFormedToken, newToken, RatingSchema, summarize } from "../lib/native-review/kit";

describe("review kit", () => {
  it("mints well-formed, unique tokens and hashes them deterministically", () => {
    const a = newToken();
    expect(isWellFormedToken(a)).toBe(true);
    expect(newToken()).not.toBe(a);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toContain(a);
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken(`${a}/../x`)).toBe(false);
  });

  it("validates ratings: 1-5 integers, bounded comment", () => {
    const ok = { item_id: "6f1c1c5e-8f2a-4a8e-9a53-0d3b7a7b1c11", lyric_quality: 4, pronunciation: 3, prosody: 2, cultural_fit: 5, sounds_native: true };
    expect(RatingSchema.safeParse(ok).success).toBe(true);
    expect(RatingSchema.safeParse({ ...ok, prosody: 6 }).success).toBe(false);
    expect(RatingSchema.safeParse({ ...ok, prosody: 2.5 }).success).toBe(false);
    expect(RatingSchema.safeParse({ ...ok, comment: "x".repeat(501) }).success).toBe(false);
  });

  it("summarizes per language with reviewer counts", () => {
    const row = (token_id: string, language: string, n: number, native: boolean) => ({
      token_id, language, lyric_quality: n, pronunciation: n, prosody: n, cultural_fit: n, sounds_native: native,
    });
    const s = summarize([row("a", "kn", 2, false), row("b", "kn", 4, true), row("a", "hi", 5, true)]);
    expect(s.map((x) => x.language)).toEqual(["hi", "kn"]);
    expect(s[1]).toMatchObject({ ratings: 2, reviewers: 2, soundsNativeShare: 0.5, mean: { prosody: 3 } });
  });
});
