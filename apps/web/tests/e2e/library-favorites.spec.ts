/**
 * E2E spec: favorites persistence (v1.4 Sprint 1, item 7).
 *
 * Bug we're guarding against:
 *   1. Click "Favorite" on a library row → star flips to filled (optimistic).
 *   2. Reload → star reverts because the SECURITY INVOKER toggle_favorite
 *      RPC's UPDATE on `jobs` was blocked by RLS (no UPDATE policy for
 *      authenticated). Migration 0035 makes the RPC SECURITY DEFINER.
 *
 * The spec toggles twice so we always leave the row in its original
 * state and don't drift the seed user's library forever.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

test("favorites persist across reload", async ({ page }) => {
  await signIn(page);
  await page.goto("/library");

  // Library is grid by default; switch to list for stable selectors.
  const listBtn = page.getByRole("button", { name: /list/i }).first();
  await listBtn.click();
  await page.waitForFunction(
    () => window.location.search.includes("view=list"),
    null,
    { timeout: 10_000 },
  );

  // Star buttons share their aria-label with the action verb. The
  // first row is the most-recent song; if the user happens to have an
  // empty library, the spec is meaningless and we skip.
  const firstFavBtn = page
    .getByRole("button", { name: /^(Favorite|Unfavorite)$/i })
    .first();

  if ((await firstFavBtn.count()) === 0) {
    test.skip(true, "seed user has no library rows to favorite");
    return;
  }

  const initialState = await firstFavBtn.getAttribute("aria-label");
  expect(initialState).not.toBeNull();
  const startsFavorited = initialState!.toLowerCase() === "unfavorite";

  // Click once → state inverts.
  const [toggleResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/favorite") && r.request().method() === "POST",
    ),
    firstFavBtn.click(),
  ]);
  expect(toggleResp.status()).toBe(200);
  const body = await toggleResp.json();
  expect(typeof body.is_favorite).toBe("boolean");
  expect(body.is_favorite).toBe(!startsFavorited);

  // Reload → state must be the post-click value, not the pre-click
  // value. This is the regression check.
  await page.reload();

  const refreshedBtn = page
    .getByRole("button", { name: /^(Favorite|Unfavorite)$/i })
    .first();
  await expect(refreshedBtn).toBeVisible();
  const afterReload = await refreshedBtn.getAttribute("aria-label");
  expect(afterReload!.toLowerCase()).toBe(
    startsFavorited ? "favorite" : "unfavorite",
  );

  // Toggle back to leave the row exactly as we found it.
  const [restoreResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/favorite") && r.request().method() === "POST",
    ),
    refreshedBtn.click(),
  ]);
  expect(restoreResp.status()).toBe(200);
  const restored = await restoreResp.json();
  expect(restored.is_favorite).toBe(startsFavorited);
});
