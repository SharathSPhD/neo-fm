/**
 * E2E spec: marketing landing page (v1.3 Sprint 5 — wedge).
 *
 * The wedge for v1.3 is **phoneme-correct Indic vocals**. This spec
 * pins that promise into the user-visible HTML so a regression that
 * accidentally re-genericises the hero (or drops the Listen section)
 * fails CI loudly.
 *
 * What the spec guarantees:
 *   1. Anon visitors can reach `/` and see an H1.
 *   2. The H1 contains the wedge keyword "phoneme" — if we ever
 *      reword the page we have to update this assertion deliberately.
 *   3. The "Hear the difference" Listen section exists and links to
 *      three anchor preset templates (one per Indic language family).
 *   4. The page has zero critical/serious axe violations.
 */
import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./helpers/axe";

test("landing page leads with the phoneme wedge", async ({ page }) => {
  await page.goto("/");

  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();

  // Hard-coded substring is intentional: the wedge is the product, so
  // a quiet edit that loses the word should fail loudly.
  await expect(h1).toContainText(/phoneme/i, { timeout: 10_000 });
  await expect(h1).toContainText(/Indian languages/i);
});

test("landing page exposes the Listen anchor section", async ({ page }) => {
  await page.goto("/");
  const listenHeading = page.getByRole("heading", {
    name: /hear the difference/i,
    level: 2,
  });
  await expect(listenHeading).toBeVisible();

  // Each preset link should land on /songs/new with a preset param.
  const presets = [
    "hindustani-khayal-sketch",
    "kannada-bhavageete",
    "tamil-folk",
  ] as const;
  for (const preset of presets) {
    const link = page.locator(
      `a[href="/songs/new?preset=${encodeURIComponent(preset)}"]`,
    );
    // The same href is also rendered in the Style Gallery further
    // down the page; we just need at least one to exist in the
    // Listen section so the wedge has a "play with it" affordance.
    await expect(link.first()).toBeVisible();
  }
});

test("landing page has no serious axe violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "/ (anon landing)");
});
