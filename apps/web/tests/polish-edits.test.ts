import { describe, expect, it } from "vitest";
import { applyLineEdits, parseLineEdits } from "../lib/lyrics/polish";
import { estimateArmUsd } from "../lib/lyrics/harness/cost";
import { ARMS } from "../lib/lyrics/harness/harness";

const lyric = "[ಪಲ್ಲವಿ]\nಒಂದು\n\nಎರಡು\nಮೂರು";

describe("edit-list polish", () => {
  it("parses a fenced JSON array and rejects other shapes", () => {
    expect(parseLineEdits('```json\n[{"line":2,"text":"x"}]\n```')).toEqual([{ line: 2, text: "x" }]);
    expect(parseLineEdits("[]")).toEqual([]);
    expect(parseLineEdits("no edits here")).toBeNull();
    expect(parseLineEdits('[{"line":"2","text":"x"}]')).toBeNull();
  });
  it("replaces numbered non-empty lines one for one and never touches section tags", () => {
    expect(applyLineEdits(lyric, [{ line: 3, text: " ಹೊಸ " }])).toBe("[ಪಲ್ಲವಿ]\nಒಂದು\nಹೊಸ\nಮೂರು");
    expect(applyLineEdits(lyric, [{ line: 1, text: "changed" }])).toBe("[ಪಲ್ಲವಿ]\nಒಂದು\nಎರಡು\nಮೂರು");
  });
  it("ignores out-of-range, empty and multi-line replacements", () => {
    expect(applyLineEdits(lyric, [{ line: 9, text: "a" }, { line: 2, text: "" }, { line: 2, text: "a\nb" }, { line: 0, text: "z" }])).toBe("[ಪಲ್ಲವಿ]\nಒಂದು\nಎರಡು\nಮೂರು");
  });
  it("the lab arm is cheaper than the plain polish arm", () => {
    expect(estimateArmUsd(ARMS.live_edits!)).toBeLessThan(estimateArmUsd(ARMS.live!));
  });
});
