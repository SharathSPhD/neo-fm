import { describe, expect, it } from "vitest";
import { HELP_COPY, HELP_LANGS, MORE_LINKS, parseHelpLang, SECTIONS } from "../lib/help/faq";

const ids = SECTIONS.flatMap((s) => s.items);

describe("help FAQ", () => {
  it("has every question in every language, non-empty", () => {
    for (const l of HELP_LANGS) {
      const c = HELP_COPY[l];
      for (const id of ids) {
        expect(c.items[id]?.q.length, `${l}.${id}.q`).toBeGreaterThan(3);
        expect(c.items[id]?.a.length, `${l}.${id}.a`).toBeGreaterThan(20);
      }
      for (const s of SECTIONS) expect(c.sections[s.id]).toBeTruthy();
    }
  });

  it("marks every translation as machine-translated; English has no notice", () => {
    expect(HELP_COPY.en.machineNotice).toBe("");
    for (const l of HELP_LANGS.filter((x) => x !== "en")) expect(HELP_COPY[l].machineNotice.length).toBeGreaterThan(20);
  });

  it("keeps facts identical across languages (prices, contact, windows)", () => {
    for (const l of HELP_LANGS) {
      const c = HELP_COPY[l].items;
      expect(c.tiers.a).toContain("₹299");
      expect(c.tiers.a).toContain("₹799");
      expect(c.tiers.a).toContain("$6.99");
      expect(c.report.a).toContain("grievance@neo-fm.com");
      expect(c.report.a).toMatch(/24|২৪/);
      expect(c.report.a).toMatch(/36|৩৬/);
      expect(c.report.a).toMatch(/15|১৫/);
    }
  });

  it("English tier numbers match the pricing page", () => {
    const a = HELP_COPY.en.items.tiers.a;
    for (const s of ["3 songs", "15 songs", "40 songs", "30 seconds", "90 seconds", "3 minutes"]) expect(a).toContain(s);
  });

  it("links only to existing public routes and falls back to English", () => {
    for (const href of Object.values(MORE_LINKS)) expect(href).toMatch(/^\/(trust|pricing|terms|privacy)(#[a-z-]+)?$/);
    expect(parseHelpLang("xx")).toBe("en");
    expect(parseHelpLang(["ta"])).toBe("ta");
    expect(parseHelpLang(undefined)).toBe("en");
  });
});
