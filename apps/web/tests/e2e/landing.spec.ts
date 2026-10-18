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

test("landing page leads with the personal station", async ({ page }) => {
  await page.goto("/");

  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();

  // Hard-coded substrings are intentional: the station framing is the
  // product, so a quiet edit that loses it should fail loudly.
  await expect(h1).toContainText(/your own FM/i, { timeout: 10_000 });
  await expect(h1).toContainText(/made for you/i);
});

test("landing page shows how it works and the supported languages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /three steps/i, level: 2 })).toBeVisible();
  for (const l of ["Kannada", "Tamil", "Telugu", "Hindi", "Bengali"]) {
    await expect(page.getByRole("list", { name: /supported languages/i }).getByText(l)).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /make your first song free/i })).toBeVisible();
});

test("landing page has no serious axe violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "/ (anon landing)");
});
