/**
 * v1.4 live-bug closeout — library favorites empty-state.
 *
 * Before 3.3, /library?fav=1 with zero favorites surfaced the "No
 * songs yet" empty state because the page used the filtered total
 * (which was zero) as a proxy for "library is empty". The fix adds
 * an unfiltered `libraryTotal` count and branches the empty state
 * on that instead.
 *
 * This spec:
 *   1. Signs in.
 *   2. Visits /library?fav=1 directly.
 *   3. Asserts "No matches" copy is shown (rather than "No songs yet")
 *      whenever there is at least one song in the library.
 *
 * If the test user has zero songs in the library (very early seed
 * envs), the test is skipped — the unfiltered branch would correctly
 * show "No songs yet" then, and there is no bug to assert.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Favorites-only with zero favorites shows 'No matches', not 'No songs yet'", async ({
  page,
}) => {
  await signIn(page);

  // Quick probe: does the user have any songs at all?
  await page.goto("/library", { waitUntil: "networkidle" });
  const totalProbe = page.locator('a[href^="/songs/"]:not([href$="/new"])');
  const hasAny = (await totalProbe.count()) > 0;
  test.skip(
    !hasAny,
    "test user has no songs yet; favorites-empty branch isn't exercised",
  );

  // Now hit the favorites-only filter. There may or may not be
  // favorites. If the chosen test user has favorites, the deeper
  // assertion is skipped (the empty state isn't shown).
  await page.goto("/library?fav=1", { waitUntil: "networkidle" });
  const cards = page.locator('a[href^="/songs/"]:not([href$="/new"])');
  const favCount = await cards.count();
  test.skip(
    favCount > 0,
    "test user has favorites; favorites-empty branch isn't exercised",
  );

  // Critical assertion: must say "No matches", not "No songs yet".
  await expect(page.getByText(/^No matches$/i)).toBeVisible();
  await expect(page.getByText(/^No songs yet$/i)).toHaveCount(0);
});
