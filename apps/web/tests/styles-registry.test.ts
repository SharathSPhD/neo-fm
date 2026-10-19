import { describe, expect, it } from "vitest";
import { POOL_DAYPARTS, POOL_LANGUAGES, POOL_MOODS, POOL_THEMES } from "../lib/pool/tags";
import { FESTIVALS, ROUTING, STYLES, getStyle } from "../lib/styles/registry";
import { lyriaHint, pceConstraint, routeStyles } from "../lib/styles/router";

describe("style registry", () => {
  it("has unique ids and uses the pool vocabularies", () => {
    const ids = STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STYLES) {
      s.moods.forEach((m) => expect(POOL_MOODS).toContain(m));
      s.themes.forEach((t) => expect(POOL_THEMES).toContain(t));
      s.dayparts.forEach((d) => expect(POOL_DAYPARTS).toContain(d));
      s.languages.forEach((l) => expect(POOL_LANGUAGES).toContain(l));
    }
  });

  it("only references real styles from festivals and routing", () => {
    for (const f of FESTIVALS) f.styles.forEach((id) => expect(getStyle(id)).toBeDefined());
    for (const id of Object.values(ROUTING.keyword_map)) expect(getStyle(id)).toBeDefined();
    for (const ids of Object.values(ROUTING.by_language)) ids.forEach((id) => expect(getStyle(id)).toBeDefined());
  });
});

describe("routeStyles", () => {
  it("routes an explicit style word", () => {
    expect(routeStyles({ text: "an abhang for the morning", language: "mr" })[0]!.style.id).toBe("mr-abhang");
    expect(routeStyles({ text: "garba for navratri", language: "gu" })[0]!.style.id).toBe("gu-garba-raas");
    expect(routeStyles({ text: "ಭಾವಗೀತೆ", language: "kn" })[0]!.style.id).toBe("kn-bhavageethe");
  });

  it("does not match keywords inside other words", () => {
    // 'rap' must not fire on 'wrapped'
    const r = routeStyles({ text: "wrapped in a blanket", language: "hi" });
    expect(r.every((c) => c.reason !== "keyword")).toBe(true);
  });

  it("never returns sacred scripture styles", () => {
    const r = routeStyles({ text: "shabad gurbani kirtan", language: "pa" }, 10);
    expect(r.map((c) => c.style.id)).not.toContain("pa-shabad-kirtan");
  });

  it("skips styles Lyria has never rendered unless allowed", () => {
    expect(routeStyles({ text: "bihu", language: "as" }).map((c) => c.style.id)).not.toContain("as-bihu-husori");
    expect(routeStyles({ text: "bihu", language: "as", allowUntested: true })[0]!.style.id).toBe("as-bihu-husori");
  });

  it("keeps raga and folk out of instrumental requests", () => {
    const r = routeStyles({ text: "sitar raga", instrumental: true }, 10);
    expect(r.map((c) => c.style.id)).not.toContain("hindustani-instrumental-raga");
    expect(routeStyles({ text: "lofi study", instrumental: true })[0]!.style.id).toBe("lofi-indian");
  });

  it("falls back to mood and daypart, then to the language default", () => {
    const dusk = routeStyles({ language: "hi", mood: "romantic", daypart: "dusk" });
    expect(dusk.length).toBeGreaterThan(0);
    expect(dusk[0]!.reason).toBe("mood-daypart");
    const def = routeStyles({ language: "ta" });
    expect(def[0]!.reason).toBe("language-default");
    expect(def[0]!.style.languages).toContain("ta");
  });

  it("returns the native hint only for a matching language", () => {
    const s = getStyle("mr-abhang")!;
    expect(lyriaHint(s, "mr").native).toContain("अभंग");
    expect(lyriaHint(s, "ta").native).toBeNull();
    const lullaby = getStyle("lullaby-regional")!;
    expect(lyriaHint(lullaby, "ta").native).toContain("தாலாட்டு");
    expect(pceConstraint(s).sections.length).toBeGreaterThan(0);
  });
});
