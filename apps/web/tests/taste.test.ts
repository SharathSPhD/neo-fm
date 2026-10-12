import { describe, expect, it } from "vitest";

import { computeTaste, userCard, type TasteSignal } from "../lib/personalization/taste";

const day = 86_400_000;
const now = Date.UTC(2026, 9, 12);
const sig = (over: Partial<TasteSignal>): TasteSignal => ({ kind: "like", language: "kannada", style: "carnatic", ageMs: 0, ...over });

describe("taste profile", () => {
  it("weights positive signals up and negative down, per language and style", () => {
    const t = computeTaste([
      sig({ kind: "like" }), sig({ kind: "play_pct", value: 0.95 }), sig({ kind: "replay" }),
      sig({ kind: "regenerate", language: "hindi", style: "bollywood-ballad" }),
      sig({ kind: "dislike", language: "hindi", style: "bollywood-ballad" }),
    ], now);
    expect(t.weights.language.kannada).toBeGreaterThan(0);
    expect(t.weights.language.hindi).toBeLessThan(0);
    expect(t.weights.style.carnatic).toBeGreaterThan(t.weights.style["bollywood-ballad"]!);
    expect(t.nSignals).toBe(5);
  });

  it("decays old signals", () => {
    const fresh = computeTaste([sig({ kind: "like", ageMs: 0 })], now).weights.language.kannada!;
    const old = computeTaste([sig({ kind: "like", ageMs: 120 * day })], now).weights.language.kannada!;
    expect(old).toBeLessThan(fresh / 2);
  });

  it("ignores short plays and unknown kinds", () => {
    const t = computeTaste([sig({ kind: "play_pct", value: 0.1 }), sig({ kind: "report" as never })], now);
    expect(t.weights.language.kannada ?? 0).toBe(0);
  });

  it("builds a bounded user card from the strongest signals only", () => {
    const t = computeTaste(
      Array.from({ length: 40 }, (_, i) => sig({ kind: "like", language: `lang${i}`, style: `style${i}` })), now);
    const card = userCard(t);
    expect(card.length).toBeLessThan(700); // ~600 tokens budget is far above this; keep cards tiny
    expect(card).toMatch(/^Listener taste/);
    expect(userCard(computeTaste([], now))).toBe("");
  });
});
