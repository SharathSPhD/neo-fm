/**
 * v1.4 Sprint 17 — favorites-persist e2e.
 *
 * Regression-guard for the Sprint 1 favorites bug: toggling the star
 * on a library row must persist across page reload and across the
 * Grid ↔ List view toggle. The existing library-favorites spec covers
 * the optimistic flip; this spec proves the *persistence* contract
 * end-to-end against the live `song_favorites` table.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Favoriting a library row persists across reload and view toggle", async ({
  page,
}) => {
  await signIn(page);

  await page.goto("/library?status=completed&view=list");
  const row = page.locator('[data-testid="library-row"]').first();
  await row.waitFor({ state: "visible", timeout: 15_000 });

  const songId = await row.getAttribute("data-song-id");
  expect(songId).toBeTruthy();

  const star = row.getByRole("button", { name: /favorite/i });
  const initialPressed = await star.getAttribute("aria-pressed");

  // Toggle and wait for the optimistic + persisted PATCH.
  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/favorite") &&
      r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await star.click();
  const resp = await respPromise;
  expect([200, 201, 204]).toContain(resp.status());

  const newPressed = await star.getAttribute("aria-pressed");
  expect(newPressed).not.toBe(initialPressed);

  // Reload — the persisted state should match the toggled value.
  await page.reload({ waitUntil: "networkidle" });
  const reloadedRow = page
    .locator(`[data-testid="library-row"][data-song-id="${songId}"]`)
    .first();
  await reloadedRow.waitFor({ state: "visible", timeout: 15_000 });
  await expect(
    reloadedRow.getByRole("button", { name: /favorite/i }),
  ).toHaveAttribute("aria-pressed", newPressed ?? "true");

  // Flip view → Grid → the same row should still be marked favorited.
  await page.goto("/library?status=completed&view=grid");
  const gridCard = page
    .locator(`[data-song-id="${songId}"]`)
    .first();
  await gridCard.waitFor({ state: "visible", timeout: 15_000 });
  await expect(
    gridCard.getByRole("button", { name: /favorite/i }),
  ).toHaveAttribute("aria-pressed", newPressed ?? "true");
});
