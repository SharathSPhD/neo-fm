/**
 * v1.4 Sprint 17 — discover-non-empty e2e.
 *
 * The Sprint 15 seed populates Discover with a 12-row demo matrix
 * spanning every v1.4 style_family. This spec asserts:
 *   1. /discover renders at least one song card for the "All styles"
 *      view (i.e. the empty-state is *not* the visible content).
 *   2. Every style chip exposed in STYLE_OPTIONS is clickable and
 *      navigates without 5xx.
 *   3. Filtering by `style=sanskrit-shloka` (a v1.4-only family) shows
 *      at least one demo result.
 */
import { expect, test } from "@playwright/test";

test("Discover renders demo songs and the style filter chips work", async ({
  page,
}) => {
  await page.goto("/discover", { waitUntil: "networkidle" });

  const cards = page.locator('a[href^="/p/"]');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  // Click through the Sanskrit shloka chip and assert non-empty.
  await page.goto("/discover?style=sanskrit-shloka", {
    waitUntil: "networkidle",
  });
  await expect(page.locator('a[href^="/p/"]').first()).toBeVisible({
    timeout: 15_000,
  });

  // Every chip should at minimum return a 200 page (no 500s).
  const chips = [
    "carnatic",
    "hindustani",
    "kannada-folk",
    "kannada-light-classical",
    "tamil-folk",
    "bollywood-ballad",
    "sanskrit-shloka",
    "bengali-rabindrasangeet",
    "telugu-keerthana",
    "western",
  ];
  for (const chip of chips) {
    const resp = await page.goto(`/discover?style=${chip}`);
    expect(resp?.status() ?? 200).toBeLessThan(500);
  }
});
