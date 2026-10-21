import { describe, expect, it } from "vitest";

import { CreateSongRequestSchema } from "../../lib/api/song-schemas";
import { englishMainEnabled } from "../../lib/languages/english-main";
import {
  normaliseTaste,
  tasteBriefEnabled,
  tasteBriefText,
  tasteFromMetadata,
  tasteScreenText,
  tasteStyleHint,
} from "../../lib/taste/brief";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("flags", () => {
  it("are off unless set to 1", () => {
    expect(tasteBriefEnabled(env({}))).toBe(false);
    expect(tasteBriefEnabled(env({ TASTE_BRIEF: "1" }))).toBe(true);
    expect(englishMainEnabled(env({}))).toBe(false);
    expect(englishMainEnabled(env({ ENGLISH_MAIN: "1" }))).toBe(true);
  });
});

describe("normaliseTaste", () => {
  it("returns null for nothing chosen or junk", () => {
    expect(normaliseTaste(undefined)).toBeNull();
    expect(normaliseTaste({ v: 1, genres: [], background: "  " })).toBeNull();
    expect(normaliseTaste({ genres: ["not-a-genre"] })).toBeNull();
    expect(normaliseTaste({ genres: ["pop", "rock", "jazz", "lo-fi", "gospel"] })).toBeNull(); // over the cap
  });
  it("dedupes and keeps a stable shape for the tuning pipeline", () => {
    const t = normaliseTaste({ genres: ["carnatic", "carnatic", "pop"], instruments: ["veena", "mridangam"], eras: ["90s"], register: "colloquial", setting: "diaspora", languages: ["ta", "en"] });
    expect(t).toEqual({
      v: 1, genres: ["carnatic", "pop"], instruments: ["veena", "mridangam"], eras: ["90s"],
      register: "colloquial", setting: "diaspora", languages: ["ta", "en"],
    });
  });
  it("round-trips through stored metadata and tolerates a bad row", () => {
    const t = normaliseTaste({ moods: ["wistful"], background: "grew up in Mysuru" });
    expect(tasteFromMetadata({ prompt: "x", taste: t })).toEqual(t);
    expect(tasteFromMetadata({ taste: "garbage" })).toBeNull();
    expect(tasteFromMetadata(undefined)).toBeNull();
  });
});

describe("rendering", () => {
  const t = normaliseTaste({ genres: ["indie folk"], moods: ["nostalgic"], instruments: ["acoustic guitar", "sitar"], eras: ["modern"], energy: "calm", background: "city kid, summers in the village" })!;
  it("states that the brief wins a conflict", () => {
    const text = tasteBriefText(t);
    expect(text).toContain("brief above wins");
    expect(text).toContain("Genres: indie folk");
    expect(text).toContain("Listener background: city kid, summers in the village");
  });
  it("keeps free text out of the sound hint", () => {
    const hint = tasteStyleHint(t);
    expect(hint).toContain("indie folk feel");
    expect(hint).toContain("featuring acoustic guitar, sitar");
    expect(hint).not.toContain("village");
  });
  it("screens only the free text", () => {
    expect(tasteScreenText(t)).toBe("city kid, summers in the village");
    expect(tasteScreenText({ v: 1, genres: ["pop"] })).toBe("");
  });
});

describe("request schema", () => {
  const base = { prompt: "a song", language: "en", style_family: "western", target_duration_seconds: 30 };
  it("accepts a taste brief on the prompt branch", () => {
    const r = CreateSongRequestSchema.safeParse({ ...base, taste: { genres: ["pop"], background: "x" } });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown genre and an overlong background", () => {
    expect(CreateSongRequestSchema.safeParse({ ...base, taste: { genres: ["polka"] } }).success).toBe(false);
    expect(CreateSongRequestSchema.safeParse({ ...base, taste: { background: "x".repeat(201) } }).success).toBe(false);
  });
});
