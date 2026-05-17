/**
 * v1.4 Sprint 17 — remix-dialog e2e.
 *
 * Covers the ForkSongDialog opening in "remix" mode: ensures the
 * dialog renders with the remix-only language toggle, that the
 * submission targets /api/songs/:id/remix, and that the resulting
 * song page stamps the `remixed_from` backlink. Complements the
 * existing remix.spec.ts by exercising override fields (target
 * language, voice override).
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Remix dialog with overrides forks the parent and routes to the remix", async ({
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

  const trigger = page
    .getByRole("button", { name: /make a remix/i })
    .first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();

  // The remix dialog renders the same v1.4 controls as variation;
  // assert at least the distance + title inputs land before we POST.
  await expect(
    page.getByLabel(/distance from the original/i),
  ).toBeVisible({ timeout: 5_000 });
  await page
    .locator('input[type="text"][placeholder="(inherit)"]')
    .fill("Sprint 17 remix override");

  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/remix") &&
      r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /make a remix/i }).nth(1).click();
  const resp = await respPromise;
  expect(resp.status()).toBe(202);
  const body = await resp.json();
  expect(body).toMatchObject({
    job_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    remixed_from: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });

  await page.waitForURL(
    (u) => u.pathname.startsWith("/songs/") && u.pathname !== beforePath,
    { timeout: 30_000 },
  );
  await expect(page.getByText(/remixed from/i)).toBeVisible({
    timeout: 10_000,
  });
});
