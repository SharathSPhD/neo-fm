/**
 * v1.4 Sprint 17 — variation-dialog e2e.
 *
 * Asserts the ForkSongDialog opens from a public song page with the
 * v1.4-only controls (distance slider, tempo override, title input)
 * and that submission POSTs to /api/songs/:id/variation with the
 * override fields. Complements `fork-dialog.spec.ts` (which exercises
 * the dialog from the owner's /songs/:id page) by hitting the public
 * `/p/:publicId` entry point — exercising the unauthenticated→signed-
 * in fork code path opened in Sprint 3.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Variation dialog from the public song page posts overrides", async ({
  page,
}) => {
  await signIn(page);

  // Pick a public song the seed produced (Sprint 15 demos guarantee
  // at least one row tagged `published_visibility='public'`).
  await page.goto("/discover");
  const firstPublic = page.locator('a[href^="/p/"]').first();
  await firstPublic.waitFor({ state: "visible", timeout: 15_000 });
  await firstPublic.click();
  await page.waitForURL(/\/p\/[a-z0-9-]+/i, { timeout: 15_000 });

  const trigger = page
    .getByRole("button", { name: /make a variation/i })
    .first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();

  const distance = page.getByLabel(/distance from the original/i);
  await expect(distance).toBeVisible({ timeout: 5_000 });
  await distance.fill("65");
  await page.locator('input[type="number"]').fill("104");

  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/variation") &&
      r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /make a variation/i }).nth(1).click();
  const resp = await respPromise;
  expect(resp.status()).toBe(202);
  const body = await resp.json();
  expect(body).toMatchObject({
    job_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    distance: 65,
  });
});
