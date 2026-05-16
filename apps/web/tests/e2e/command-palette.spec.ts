/**
 * E2E spec: Cmd+K command palette (Sprint 7.3).
 *
 * Covers:
 *   - Ctrl+K opens the palette
 *   - typing "Disc" + Enter navigates to /discover
 *   - the palette closes after navigation
 *   - axe critical/serious violations: 0 on the open palette
 *
 * We use Ctrl+K (not Meta+K) because the test runs on Linux and
 * isMac() inside the palette decides the modifier per platform.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";
import { expectNoSeriousA11yViolations } from "./helpers/axe";

test("Ctrl+K opens palette and Enter navigates", async ({ page }) => {
  await signIn(page);
  await page.goto("/library");
  await page.keyboard.press("Control+K");
  const palette = page.locator("[cmdk-root]").first();
  await expect(palette).toBeVisible({ timeout: 5_000 });
  // The palette renders a search input that we can type into.
  await page.keyboard.type("Disc");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/discover/, { timeout: 10_000 });
  await expect(page).toHaveURL(/\/discover$/);
  await expect(palette).toBeHidden({ timeout: 5_000 });
});

test("palette has no critical/serious a11y violations when open", async ({ page }) => {
  await signIn(page);
  await page.goto("/library");
  await page.keyboard.press("Control+K");
  await page.locator("[cmdk-root]").first().waitFor({ state: "visible" });
  await expectNoSeriousA11yViolations(page, "command-palette open");
});
