import { describe, expect, it } from "vitest";

import { TASTE_ENERGY, TASTE_ERAS, TASTE_GENRES, TASTE_INSTRUMENTS, TASTE_MOODS, TASTE_REGISTERS, TASTE_SETTINGS } from "../../lib/taste/brief";
import { tasteLabel } from "../../lib/taste/labels";

const ALL = [...TASTE_GENRES, ...TASTE_MOODS, ...TASTE_INSTRUMENTS, ...TASTE_ERAS, ...TASTE_ENERGY, ...TASTE_REGISTERS, ...TASTE_SETTINGS];
const PLAIN = ["hi", "mr", "ta", "te", "kn", "bn"];

describe("taste labels", () => {
  it("translate every vocabulary token in every Indian UI language", () => {
    for (const lang of PLAIN) for (const token of ALL) expect(tasteLabel(token, lang), `${lang}:${token}`).not.toBe(token);
  });
  it("fall back to the English token for English or an unknown language", () => {
    expect(tasteLabel("veena", "en")).toBe("veena");
    expect(tasteLabel("veena", "xx")).toBe("veena");
    expect(tasteLabel("not-a-token", "hi")).toBe("not-a-token");
  });
});
