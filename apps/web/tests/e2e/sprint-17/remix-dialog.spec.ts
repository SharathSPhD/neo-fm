/**
 * v1.4 Sprint 17 — remix-dialog e2e.
 *
 * Covers the ForkSongDialog opening in "remix" mode: ensures the
 * dialog renders with the v1.4 controls, that the submission targets
 * /api/songs/:id/remix, and that the resulting song page stamps the
 * `remixed_from` backlink.
 *
 * v1.4 live-bug closeout (3.1): voice and raga are now <select>s, and
 * the title input is no longer the only `placeholder="(inherit)"`
 * input on the form. Use `getByLabel` to disambiguate.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Remix dialog with voice + raga + title overrides forks and routes", async ({
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

  await expect(
    page.getByLabel(/distance from the original/i),
  ).toBeVisible({ timeout: 5_000 });
  await page.getByLabel(/^Title$/i).fill("Sprint 17 remix override");

  // Voice dropdown: pick the first concrete option if one exists for
  // the doc's language.
  const voiceSelect = page.getByTestId("fork-voice");
  const voiceOptions = voiceSelect.locator("option");
  const voiceCount = await voiceOptions.count();
  let pickedVoiceId: string | null = null;
  if (voiceCount > 1) {
    pickedVoiceId = await voiceOptions.nth(1).getAttribute("value");
    if (pickedVoiceId) {
      await voiceSelect.selectOption(pickedVoiceId);
    }
  }

  // Raga dropdown: visible for raga-aware families. Pick the first
  // concrete option so the request body carries `raga_override`.
  const ragaSelect = page.getByTestId("fork-raga-name");
  const ragaVisible = await ragaSelect.isVisible().catch(() => false);
  let pickedRagaName: string | null = null;
  if (ragaVisible) {
    const ragaOptions = ragaSelect.locator("option");
    const ragaCount = await ragaOptions.count();
    if (ragaCount > 1) {
      pickedRagaName = await ragaOptions.nth(1).getAttribute("value");
      if (pickedRagaName) {
        await ragaSelect.selectOption(pickedRagaName);
      }
    }
  }

  const reqPromise = page.waitForRequest(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/remix") &&
      r.method() === "POST",
    { timeout: 30_000 },
  );
  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/remix") &&
      r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /make a remix/i }).nth(1).click();
  const req = await reqPromise;
  const sentBody = JSON.parse(req.postData() ?? "{}");
  if (pickedVoiceId) {
    expect(sentBody).toMatchObject({ voice_id: pickedVoiceId });
  }
  if (pickedRagaName) {
    expect(sentBody.raga_override?.name).toBe(pickedRagaName);
  }
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
