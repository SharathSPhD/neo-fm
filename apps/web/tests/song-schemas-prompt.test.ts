import { describe, expect, it } from "vitest";

import { CreateSongRequestSchema } from "../lib/api/song-schemas";

const rest = { language: "ta", style_family: "western", target_duration_seconds: 60 };

describe("CreateSongRequestSchema prompt", () => {
  it("rejects an empty or whitespace-only prompt", () => {
    expect(CreateSongRequestSchema.safeParse({ ...rest, prompt: "" }).success).toBe(false);
    expect(CreateSongRequestSchema.safeParse({ ...rest, prompt: "   \n\t " }).success).toBe(false);
  });

  it("trims a real prompt", () => {
    const parsed = CreateSongRequestSchema.safeParse({ ...rest, prompt: "  a monsoon song  " });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.prompt).toBe("a monsoon song");
  });
});
