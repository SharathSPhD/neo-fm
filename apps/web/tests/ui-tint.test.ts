import { describe, expect, it } from "vitest";

import { trackTint } from "@/lib/ui/tint";

describe("trackTint", () => {
  it("is deterministic per seed", () => {
    expect(trackTint("abc")).toEqual(trackTint("abc"));
  });
  it("differs across seeds and emits hsl triplets", () => {
    const a = trackTint("track-1");
    const b = trackTint("track-2");
    expect(a).not.toEqual(b);
    for (const v of [a.a, a.b, a.c]) expect(v).toMatch(/^\d{1,3} 78% 56%$/);
  });
});
