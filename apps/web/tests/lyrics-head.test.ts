import { describe, expect, it } from "vitest";

import { headLines } from "../lib/admin/lyrics-head";
import { validateItems } from "../lib/admin/test-render";

describe("headLines", () => {
  it("drops markdown headings, bracket and section labels, keeps sung lines in order", () => {
    const l = "## Hook\nline one\nline two\n\n**[Verse 1]**\nline three\n[Pallavi]\nline four\nline five";
    expect(headLines(l, 4)).toBe("line one\nline two\nline three\nline four");
  });

  it("drops script-specific section labels and italic notes", () => {
    const l = "పల్లవి\nమొదటి పాదం\nరెండవ పాదం\n\nచరణం\nమూడవ పాదం\n*Vimarsa fired on aspects: x*";
    expect(headLines(l, 3)).toBe("మొదటి పాదం\nరెండవ పాదం\nమూడవ పాదం");
  });

  it("keeps at least one line", () => {
    expect(headLines("a\nb", 0)).toBe("a");
  });
});

describe("test-render max_lines", () => {
  const item = { label: "hi-x", language: "hi", brief_id: "hi-1" };
  it("accepts 1 to 20 and rejects other values", () => {
    expect(validateItems({ items: [{ ...item, max_lines: 4 }] }, 3).ok).toBe(true);
    expect(validateItems({ items: [{ ...item, max_lines: 0 }] }, 3).ok).toBe(false);
    expect(validateItems({ items: [{ ...item, max_lines: 2.5 }] }, 3).ok).toBe(false);
  });
});
