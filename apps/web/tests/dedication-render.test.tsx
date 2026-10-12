import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderDedicationCard } from "@/lib/share/dedication-image";
import { latin } from "./helpers/latin-font";

// UPDATE_SHARE_FIXTURES=1 writes PNGs to tests/fixtures/dedication/ for review.
const CASES: [string, "og" | "story", string, string, string][] = [
  ["en-og", "og", "Amma", "Happy birthday! Thank you for every lullaby.", "Raag Bhairavi"],
  ["kn-og", "og", "ಅಮ್ಮ", "ಹುಟ್ಟುಹಬ್ಬದ ಶುಭಾಶಯಗಳು! ನಿನ್ನ ಪ್ರೀತಿಗೆ ನನ್ನ ಈ ಹಾಡು.", "Malenada Hudugi"],
  ["hi-story", "story", "दादी जी", "जन्मदिन मुबारक हो! आपकी दुआओं के बिना ये गाना अधूरा था। दिल से शुक्रिया।", "Barsaat ki Raat"],
  ["ta-story", "story", "அப்பா", "பிறந்தநாள் வாழ்த்துகள் அப்பா! உங்கள் அன்புக்கு இந்தப் பாடல்.", "Mazhai"],
  ["mixed-og", "og", "Priya", "Happy anniversary, मेरी जान ❤", "Raag Yaman"],
];

describe("dedication card render", () => {
  for (const [key, variant, to, message, title] of CASES) {
    it(`renders ${key}`, async () => {
      const res = await renderDedicationCard({
        variant, to, message, title, seed: key,
        linkText: "neo-fm.app/s/abcd234567", baseFonts: await latin(),
      });
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      if (process.env.UPDATE_SHARE_FIXTURES) {
        const dir = join(process.cwd(), "tests/fixtures/dedication");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${key}.png`), png);
      }
    });
  }
});
