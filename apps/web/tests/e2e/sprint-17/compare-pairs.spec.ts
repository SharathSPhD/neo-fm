/**
 * v1.4 Sprint 17 — compare-pairs e2e.
 *
 * Exercises the Sprint 16 RLHF pairwise preference UI:
 *   1. Navigate to /songs/[id]/compare for a song with ≥2 candidate
 *      tracks (the worker generates these when `top_n_candidates > 1`).
 *   2. Confirm two audio elements render and the three vote buttons
 *      are present and enabled.
 *   3. Click "A sounds better"; assert the POST to /api/songs/[id]/
 *      compare returns 200 and the form acknowledges with a status
 *      message that feeds the reranker copy.
 *
 * The spec gracefully skips when the seeded fixtures don't yet
 * include a multi-candidate job (preserves CI stability before the
 * DGX worker fully lands top-N rendering).
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Compare page records a pairwise preference vote", async ({ page }) => {
  await signIn(page);

  // Pick the first song in the library; the e2e seed user is
  // configured (Sprint 16) to include at least one multi-candidate
  // job. If not, skip — Sprint 16's web-level vitest already proves
  // the API contract.
  await page.goto("/library?status=completed&view=list");
  const songLink = page
    .locator(
      'a[href^="/songs/"]:not([href="/songs/new"]):not([href^="/songs/new"])',
    )
    .first();
  await songLink.waitFor({ state: "visible", timeout: 15_000 });
  await songLink.click();
  await page.waitForURL(/\/songs\/[0-9a-f-]{36}/, { timeout: 15_000 });
  const songId = new URL(page.url()).pathname.split("/").pop();
  test.skip(!songId, "Could not parse song id from URL");

  await page.goto(`/songs/${songId}/compare`);
  const audios = page.locator("audio");
  const audioCount = await audios.count();
  test.skip(
    audioCount < 2,
    "Compare page requires ≥2 candidate tracks; seed not yet generating top-N",
  );

  await expect(
    page.getByRole("button", { name: /a sounds better/i }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /too close to tell/i }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /b sounds better/i }),
  ).toBeEnabled();

  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/compare") &&
      r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /a sounds better/i }).click();
  const resp = await respPromise;
  expect(resp.status()).toBe(200);

  await expect(page.getByRole("status")).toContainText(/vote recorded/i);
});
