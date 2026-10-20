import { describe, expect, it } from "vitest";

import { renderShareCard } from "@/lib/share/card-image";
import { trackCardContent } from "@/lib/share/track-card";

import { latin } from "./helpers/latin-font";

describe("trackCardContent", () => {
  it("puts a native-script title in the shaped lines, not the Latin slot", () => {
    const c = trackCardContent({ title: "ಮಲೆನಾಡ ಹುಡುಗಿ", language: "kn" });
    expect(c.title).toBe("Kannada song");
    expect(c.excerpt).toEqual(["ಮಲೆನಾಡ ಹುಡುಗಿ"]);
  });
  it("keeps a Latin title and adds the language's own name as the shaped line", () => {
    const c = trackCardContent({ title: "Tamil folk", language: "ta" });
    expect(c.title).toBe("Tamil folk");
    expect(c.subtitle).toBe("AI-made Tamil music on neo-fm");
    expect(c.excerpt).toEqual(["தமிழ்"]);
  });
  it("clips a long native title to one line and has no excerpt for a language without a page", () => {
    const long = trackCardContent({ title: "अ".repeat(60), language: "hi" });
    expect(Array.from(long.excerpt[0]!)).toHaveLength(24);
    expect(trackCardContent({ title: "Punjabi folk", language: "pa" }).excerpt).toEqual([]);
  });
  it("renders a PNG for each launch language, native and Latin titles", async () => {
    const cases = [
      ["kn", "ಮಲೆನಾಡ ಹುಡುಗಿ"], ["hi", "बरसात की रात"], ["te", "ప్రేమ స్వప్నం"], ["ta", "மழை பெய்யும் நேரம்"], ["mr", "पावसाची रात्र"],
      ["kn", "Kannada folk"], ["mr", "Marathi lavani"],
    ] as const;
    for (const [language, title] of cases) {
      const res = await renderShareCard({ ...trackCardContent({ title, language }), seed: title, baseFonts: await latin() });
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.length).toBeGreaterThan(5_000);
    }
  });
});
