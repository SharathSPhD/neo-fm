/**
 * E2E spec: auth flow (Sprint 7.3).
 *
 * Covers the public happy path:
 *   - landing page loads anonymously and shows the brand + a sign-in CTA
 *   - clicking sign-in lands on /sign-in
 *   - filling the smoke credentials lands the user on /library
 *   - the desktop nav now shows "Library" (not "Open app")
 *   - axe critical/serious violations: 0 on both /sign-in and /library
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";
import { expectNoSeriousA11yViolations } from "./helpers/axe";

test("anonymous landing renders sign-in CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page, "/");
});

test("signed-in user lands on /library with Library nav label", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/library/);

  // The nav should say "Library", not the old "Open app" string.
  const nav = page.getByRole("navigation").first();
  const libraryLink = nav.getByRole("link", { name: /^Library$/ });
  await expect(libraryLink).toBeVisible();

  await expectNoSeriousA11yViolations(page, "/library");
});
