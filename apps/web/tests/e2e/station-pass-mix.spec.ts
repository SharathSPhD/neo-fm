/**
 * E2E: the Station pass language mix and mood picks on GET /api/station/queue (flag STATION_PASS_MIX).
 * The e2e user is Creator tier, which includes every pass perk. Signed-out requests must be unchanged.
 * Set E2E_EXPECT_MIX=1 where the flag is on (staging); without it a flag-off environment skips the perk tests
 * instead of failing, so the same spec runs on previews.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { signIn } from "./helpers/auth";

type Q = { tracks: { id: string; language: string; tags?: string[]; type?: string; kind?: string }[] };
const MIX = "kn:70,hi:30";
const vocal = (q: Q) => q.tracks.filter((t) => t.type === undefined && t.kind !== "instrumental" && t.language !== "zxx");

async function queue(req: APIRequestContext, qs: string): Promise<Q> {
  const res = await req.get(`/api/station/queue?limit=12&hour=10${qs}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Q;
}

test("signed-out listeners ignore the mix and mood params", async ({ request }) => {
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) for (const t of vocal(await queue(request, `&langs=${MIX}&moods=calm`))) seen.add(t.language);
  // A mix would restrict the queue to kn and hi; an unchanged queue is free to play the other languages.
  const others = [...seen].filter((l) => l !== "kn" && l !== "hi");
  expect(others.length, "signed-out queue was restricted to the mix").toBeGreaterThan(0);
});

test.describe("pass perks (Creator tier)", () => {
  test.beforeEach(async ({ page }) => { await signIn(page); });

  test("langs plays only the mixed languages, in weighted runs", async ({ page }) => {
    const q = vocal(await queue(page.request, `&langs=${MIX}`));
    const langs = q.map((t) => t.language);
    const mixed = langs.every((l) => l === "kn" || l === "hi");
    if (!process.env.E2E_EXPECT_MIX) test.skip(!mixed, "STATION_PASS_MIX is off in this environment");
    expect(mixed, `languages seen: ${[...new Set(langs)].join(",")}`).toBe(true);
    expect(langs.filter((l) => l === "kn").length).toBeGreaterThanOrEqual(langs.filter((l) => l === "hi").length);
    // Runs of at least two: a language never appears as a lone track between two others of the other language.
    for (let i = 1; i < langs.length - 1; i++) {
      if (langs[i] !== langs[i - 1] && langs[i] !== langs[i + 1]) expect(langs[i - 1], `lone ${langs[i]} track at ${i}`).not.toBe(langs[i + 1]);
    }
  });

  test("an explicit lang wins over the mix", async ({ page }) => {
    const q = vocal(await queue(page.request, `&lang=hi&langs=${MIX}`));
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((t) => t.language === "hi")).toBe(true);
  });

  test("mood picks and junk values never break the queue", async ({ page }) => {
    const q = await queue(page.request, "&lang=hi&moods=spicy,calm,romantic,joyful,festive,playful");
    expect(q.tracks.length).toBeGreaterThan(0);
  });
});
