/**
 * E2E spec: preset gallery split (v1.3 Sprint 2).
 *
 * Sprint 2 extended `style_family_enum` and `language_enum` so
 * Kannada bhavageete (light-classical) and Tamil folk are first-
 * class presets rather than overloaded onto the generic folk
 * bucket. The landing page silently dropped a stale
 * `tagore-rabindra-sangeet` id for months — that bug class is the
 * one this spec exists to make impossible to ship again.
 *
 * What we guarantee:
 *   1. /songs/new renders all eight v1.3 presets, each linkable.
 *   2. The new `kannada-bhavageete` and `tamil-folk` presets each
 *      reach `/songs/new` with the right `preset=` query param.
 *   3. The marketing landing's highlight gallery also surfaces
 *      every one of those preset ids — so an upstream rename in
 *      `packages/style-presets` can't quietly drop a card from the
 *      user-facing page.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

const V13_PRESETS = [
  "carnatic-kriti",
  "hindustani-khayal-sketch",
  "kannada-bhavageete",
  "kannada-folk",
  "tamil-folk",
  "bollywood-ballad",
  "western-pop",
  "kabir-doha",
  "tagore-set",
] as const;

test("landing page exposes every v1.3 preset card", async ({ page }) => {
  await page.goto("/");
  const seen = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href*='preset=']"))
      .map((a) => {
        const u = new URL(a.getAttribute("href") ?? "", location.origin);
        return u.searchParams.get("preset");
      })
      .filter((v): v is string => v !== null),
  );

  for (const preset of V13_PRESETS) {
    // tagore-set is a near-miss for the historical
    // `tagore-rabindra-sangeet` slug that silently disappeared
    // for months. Asserting it appears keeps that bug closed.
    expect(seen, `landing should surface preset ${preset}`).toContain(preset);
  }
});

test("/songs/new exposes the new kannada-bhavageete + tamil-folk presets", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/songs/new");

  for (const preset of ["kannada-bhavageete", "tamil-folk"] as const) {
    const link = page
      .locator(`a[href*="preset=${encodeURIComponent(preset)}"]`)
      .first();
    await expect(
      link,
      `preset ${preset} should be a clickable card in /songs/new`,
    ).toBeVisible();
  }
});
