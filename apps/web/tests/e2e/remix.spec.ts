/**
 * E2E spec: Make a remix (Sprint 7.3).
 *
 * Covers:
 *   - the "Make a remix" CTA is visible on a completed song
 *   - clicking it posts /api/songs/{id}/remix and navigates to the
 *     new job's detail page
 *   - the new page shows the "Remixed from {title}" backlink
 *   - axe critical/serious violations: 0 on the remix detail page
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";
import { expectNoSeriousA11yViolations } from "./helpers/axe";

test("Make a remix forks the parent song and stamps lineage", async ({ page }) => {
  await signIn(page);

  // Pick the first non-/new completed song from the library list.
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

  // v1.4 Sprint 3: the remix button now opens a ForkSongDialog. Click
  // the trigger first, then submit from the dialog footer.
  const remixTrigger = page
    .getByRole("button", { name: /make a remix/i })
    .first();
  await remixTrigger.waitFor({ state: "visible", timeout: 10_000 });
  await remixTrigger.click();

  // Wait for the dialog's submit (the second "Make a remix" button) to
  // appear, then submit.
  const submitBtn = page
    .getByRole("button", { name: /make a remix/i })
    .nth(1);
  await submitBtn.waitFor({ state: "visible", timeout: 10_000 });

  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/remix") &&
      r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await submitBtn.click();
  const resp = await respPromise;
  expect(resp.status()).toBe(202);
  const body = await resp.json();
  expect(body).toMatchObject({
    job_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    status: expect.stringMatching(/^(queued|processing|completed)$/),
    remixed_from: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });

  await page.waitForURL(
    (u) => u.pathname.startsWith("/songs/") && u.pathname !== beforePath,
    { timeout: 30_000 },
  );

  await expect(page.getByText(/remixed from/i)).toBeVisible({
    timeout: 10_000,
  });
  await expectNoSeriousA11yViolations(page, "/songs/[remix]");
});
