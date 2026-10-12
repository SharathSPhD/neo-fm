import { describe, expect, it } from "vitest";

import {
  buildSharePayload,
  detectScript,
  pickExcerpt,
  reorderForSatori,
  waveformBars,
} from "@/lib/share/card";

describe("share card helpers", () => {
  it("detects Indic scripts", () => {
    expect(detectScript("नमस्ते")).toBe("devanagari");
    expect(detectScript("வணக்கம்")).toBe("tamil");
    expect(detectScript("ನಮಸ್ಕಾರ")).toBe("kannada");
    expect(detectScript("hello")).toBe("latin");
  });

  it("prefers the chorus and skips markers/blank lines", () => {
    const out = pickExcerpt([
      { type: "verse", lyrics: "verse one\nverse two" },
      { type: "chorus", script: "[Chorus]\n\nतेरी बातें\nमेरे गीत\nतीसरी" },
    ]);
    expect(out).toEqual(["तेरी बातें", "मेरे गीत"]);
  });

  it("clips long lines and returns [] when no lyrics", () => {
    const long = "ಅ ".repeat(60).trim();
    expect(pickExcerpt([{ lyrics: long }])[0]!.endsWith("…")).toBe(true);
    expect(pickExcerpt([{ lyrics: "" }])).toEqual([]);
    expect(pickExcerpt(undefined)).toEqual([]);
  });

  it("waveform is deterministic and bounded", () => {
    const a = waveformBars("abc123");
    expect(a).toEqual(waveformBars("abc123"));
    expect(a).not.toEqual(waveformBars("zzz999"));
    expect(a.every((v) => v > 0 && v <= 1)).toBe(true);
  });

  it("builds a share payload", () => {
    expect(buildSharePayload("Raag", "https://x/s/1").url).toBe("https://x/s/1");
  });

  it("moves pre-base vowel signs ahead of the consonant for satori", () => {
    expect(reorderForSatori("दिल")).toBe("दि".split("").reverse().join("") + "ल");
    expect(reorderForSatori("कुल")).toBe("कुल");
    expect(reorderForSatori("hello")).toBe("hello");
  });
});

import { latin } from "./helpers/latin-font";

describe("per-script excerpt switch", () => {
  it("title-only card when a script is switched off", async () => {
    const { EXCERPT_SCRIPTS_ENABLED } = await import("@/lib/share/card");
    const { renderShareCard } = await import("@/lib/share/card-image");
    const on = await renderShareCard({ title: "T", subtitle: "S", excerpt: ["ಪ್ರೀತಿ ಸ್ನೇಹ"], seed: "x", baseFonts: await latin() });
    EXCERPT_SCRIPTS_ENABLED.kannada = false;
    try {
      const off = await renderShareCard({ title: "T", subtitle: "S", excerpt: ["ಪ್ರೀತಿ ಸ್ನೇಹ"], seed: "x", baseFonts: await latin() });
      const [a, b] = [Buffer.from(await on.arrayBuffer()), Buffer.from(await off.arrayBuffer())];
      expect(a.equals(b)).toBe(false);
      expect(b.length).toBeLessThan(a.length);
    } finally {
      EXCERPT_SCRIPTS_ENABLED.kannada = true;
    }
  });
});
