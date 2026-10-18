import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { clip, renderCollectionCard } from "@/lib/collections/card-image";

import { latin } from "./helpers/latin-font";

// Representative titles per script (not prod data). UPDATE_SHARE_FIXTURES=1
// regenerates tests/fixtures/collection-cards/*.png for visual review.
const CASES: [string, string, string[], number][] = [
  ["hi", "मेरे भजन", ["हनुमान चालीसा", "राम सिया राम", "गणपति वंदना"], 7],
  ["ta", "மழைக் காலப் பாடல்கள்", ["மழை", "காதல் வேளை"], 2],
  ["te", "ప్రేమ గీతాలు", ["ప్రేమ స్వప్నం", "కృష్ణ వర్షం", "నీ చూపులో"], 3],
  ["kn", "ಮಲೆನಾಡು ಹಾಡುಗಳು", ["ಹೃದಯದ ಸ್ವರ", "ಪ್ರೀತಿ ಸ್ನೇಹ"], 2],
  ["bn", "বর্ষার গান", ["বিকেলের আকাশ", "মেঘ"], 12],
  ["en", "Late night drive", ["Barsaat ki Raat", "Dil ki dhadkan"], 2],
  ["empty", "neo-fm", [], 0],
];

describe("collection card render", () => {
  for (const [key, title, songTitles, songCount] of CASES) {
    it(`renders ${key}`, async () => {
      const res = await renderCollectionCard({
        title,
        songTitles,
        songCount,
        seed: key,
        baseFonts: await latin(),
      });
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.length).toBeGreaterThan(5_000);
      if (process.env.UPDATE_SHARE_FIXTURES) {
        const dir = join(process.cwd(), "tests/fixtures/collection-cards");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${key}.png`), png);
      }
    });
  }

  it("clips by characters, not UTF-16 units", () => {
    expect(clip("abc", 5)).toBe("abc");
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(Array.from(clip("𝒜𝒜𝒜𝒜𝒜", 3))).toHaveLength(3);
  });
});
