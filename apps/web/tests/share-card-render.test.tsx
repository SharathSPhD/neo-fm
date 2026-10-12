import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pickExcerpt } from "@/lib/share/card";
import { renderShareCard } from "@/lib/share/card-image";

// Representative lyrics per script (not prod data). Run with
// UPDATE_SHARE_FIXTURES=1 to regenerate tests/fixtures/share-cards/*.png
// for visual review; otherwise this just proves every script renders.
const CASES: [string, string, string, string][] = [
  ["hi", "Barsaat ki Raat", "Hindustani · Hindi", "बरसात की रात में तेरा नाम\nदिल की हर धड़कन में तेरा नाम"],
  ["bn", "Brishti", "Bengali · Rabindra Sangeet", "বিকেলের নীল আকাশে কিছু\nমেঘ ভেসে যায় দূরে"],
  ["ta", "Mazhai", "Tamil · Tamil folk", "மழை பெய்யும் நேரம் கொடுத்த\nகாதல் சொல்லும் வேளை"],
  ["te", "Prema", "Telugu keerthana", "ప్రేమ స్వప్నం కృష్ణ వర్షం\nనీ చూపులో వెలుగు నింపి"],
  ["kn", "Malenada Hudugi", "Kannada folk", "ಪ್ರೀತಿ ಸ್ನೇಹ ಕೃಷ್ಣ ಸಂಗೀತ\nಹೃದಯದ ಸ್ವರ್ಗ ಕರ್ನಾಟಕ"],
];

import { latin } from "./helpers/latin-font";

describe("share card render", () => {
  for (const [key, title, subtitle, lyrics] of CASES) {
    it(`renders ${key}`, async () => {
      const excerpt = pickExcerpt([{ type: "chorus", script: lyrics }]);
      const res = await renderShareCard({ title, subtitle, excerpt, seed: key, baseFonts: await latin() });
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.length).toBeGreaterThan(5_000);
      if (process.env.UPDATE_SHARE_FIXTURES) {
        const dir = join(process.cwd(), "tests/fixtures/share-cards");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${key}.png`), png);
      }
    });
  }
});
