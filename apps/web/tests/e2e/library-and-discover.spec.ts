/**
 * E2E spec: library + discover surfaces (Sprint 7.3).
 *
 * Covers:
 *   - /library renders in Grid view by default (Sprint 6.2)
 *   - the view toggle flips to ?view=list and back
 *   - /discover renders the public grid for anonymous + authed users
 *   - axe critical/serious violations: 0 on both views
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";
import { expectNoSeriousA11yViolations } from "./helpers/axe";

test("library defaults to grid view and toggles to list", async ({ page }) => {
  await signIn(page);
  await page.goto("/library");
  // Grid button is aria-pressed=true initially.
  const gridBtn = page.getByRole("button", { name: /grid/i }).first();
  await expect(gridBtn).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousA11yViolations(page, "/library?grid");

  const listBtn = page.getByRole("button", { name: /list/i }).first();
  await listBtn.click();
  // router.replace doesn't fire navigation events, so we wait on the
  // URL search-string updating client-side.
  await page.waitForFunction(
    () => window.location.search.includes("view=list"),
    null,
    { timeout: 10_000 },
  );
  await expect(listBtn).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousA11yViolations(page, "/library?list");

  // And toggle back to grid for cleanliness.
  await gridBtn.click();
  await page.waitForFunction(
    () => !window.location.search.includes("view=list"),
    null,
    { timeout: 10_000 },
  );
});

test("discover is anonymously reachable and renders", async ({ page }) => {
  // No sign-in: /discover is in the marketing route group and should
  // serve to anonymous visitors.
  await page.goto("/discover");
  await expect(page).toHaveURL(/\/discover/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "/discover (anon)");
});

test("discover renders for signed-in users too", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "/discover (authed)");
});
