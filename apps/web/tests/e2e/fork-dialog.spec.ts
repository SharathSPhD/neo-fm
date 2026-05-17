/**
 * v1.4 Sprint 3 — E2E spec for the shared ForkSongDialog.
 *
 * Covers:
 *   - the dialog opens with the v1.4 controls (distance slider,
 *     tempo / key / voice / title inputs)
 *   - submitting a populated body posts to /api/songs/[id]/variation
 *     with the override fields, and the response routes to the new
 *     job's detail page
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

test("ForkSongDialog submits a populated variation with overrides", async ({
  page,
}) => {
  await signIn(page);

  await page.goto("/library?status=completed&view=list");
  const songLink = page
    .locator(
      'a[href^="/songs/"]:not([href="/songs/new"]):not([href^="/songs/new"])',
    )
    .first();
  await songLink.waitFor({ state: "visible", timeout: 15_000 });
  await songLink.click();
  await page.waitForURL(/\/songs\/[0-9a-f-]{36}/, { timeout: 15_000 });
  const beforePath = new URL(page.url()).pathname;

  const trigger = page.getByRole("button", { name: /make a variation/i }).first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();

  // Sanity-check that the dialog body fields actually rendered.
  const distance = page.getByLabel(/distance from the original/i);
  await expect(distance).toBeVisible({ timeout: 5_000 });
  await distance.fill("80");

  // Tempo is a number input; title is the only text input with the
  // exact placeholder "(inherit)" (key/voice have "(inherit, e.g. …)").
  await page.locator('input[type="number"]').fill("125");
  await page
    .locator('input[type="text"][placeholder="(inherit)"]')
    .fill("Variation title");

  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/variation") &&
      r.request().method() === "POST",
    { timeout: 30_000 },
  );
  const submit = page.getByRole("button", { name: /make a variation/i }).nth(1);
  await submit.click();
  const resp = await respPromise;
  expect(resp.status()).toBe(202);
  const body = await resp.json();
  expect(body).toMatchObject({
    job_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    status: expect.stringMatching(/^(queued|processing|completed)$/),
    distance: 80,
  });

  await page.waitForURL(
    (u) => u.pathname.startsWith("/songs/") && u.pathname !== beforePath,
    { timeout: 30_000 },
  );
});
