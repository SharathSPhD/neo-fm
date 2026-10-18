/**
 * First-run guide, synced lyrics and empty state on the dev-only
 * /dev-preview harness (404s in production builds, so this spec skips
 * itself there). Run locally with:
 *   E2E_BASE_URL=http://localhost:3000 pnpm playwright test first-run-preview
 * Set SHOTS=1 to write screenshots to tests/e2e/.screens/.
 */
import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./helpers/axe";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 800 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      const res = await page.goto("/dev-preview", { waitUntil: "networkidle" });
      test.skip(res?.status() === 404, "dev-preview is disabled in production builds");
    });

    test("no horizontal overflow and no serious a11y violations", async ({ page }) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoSeriousA11yViolations(page, `dev-preview ${vp.name}`);
    });

    test("picking a language switches the UI and the ideas", async ({ page }) => {
      await page.getByRole("radio", { name: "தமிழ்" }).click();
      await expect(page.getByRole("heading", { name: "உங்கள் முதல் பாடலை உருவாக்குங்கள்" })).toBeVisible();
      await expect(page.getByTestId("first-run-idea")).toHaveCount(3);
      await page.getByTestId("first-run-idea").first().click();
      await expect(page.locator("#prompt")).toHaveValue(/மழைக்காலத்தில்/);
      if (process.env.SHOTS) await page.screenshot({ path: `tests/e2e/.screens/first-run-ta-${vp.name}.png`, fullPage: true });
    });

    test("hear-the-mood toggles and stops", async ({ page }) => {
      const btn = page.getByTestId("first-run-hear");
      await btn.click();
      await expect(btn).toHaveAttribute("aria-pressed", "true");
      await btn.click();
      await expect(btn).toHaveAttribute("aria-pressed", "false");
    });

    test("lyrics follow playback and tapping a line seeks", async ({ page }) => {
      const panel = page.getByTestId("lyrics-panel");
      await expect(panel.getByRole("button").first()).toBeVisible();
      const lines = panel.getByRole("button");
      await lines.nth(5).click();
      await expect(lines.nth(5)).toHaveAttribute("aria-current", "true");
      const t = await page.evaluate(() => document.querySelector("audio")!.currentTime);
      expect(t).toBeGreaterThan(15);
      if (process.env.SHOTS) await page.screenshot({ path: `tests/e2e/.screens/lyrics-${vp.name}.png`, fullPage: true });
    });
  });
}
