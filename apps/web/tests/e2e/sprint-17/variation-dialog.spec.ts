/**
 * v1.4 Sprint 17 — variation-dialog e2e.
 *
 * Asserts the ForkSongDialog opens from a public song page with the
 * v1.4-only controls (distance slider, tempo input, voice + raga
 * dropdowns, title input) and that submission POSTs to
 * /api/songs/:id/variation with the override fields. Complements
 * `fork-dialog.spec.ts` (which exercises the dialog from the owner's
 * /songs/:id page) by hitting the public `/s/:publicId` entry point —
 * exercising the unauthenticated→signed-in fork code path opened in
 * Sprint 3.
 *
 * v1.4 live-bug closeout (3.1): the tempo input is now `type="text"
 * inputMode="numeric"` (the old `type="number"` exposed a misleading
 * `30` default at min=30); voice and raga are <select>s sourced from
 * VOICE_CATALOGUE and ragasForStyle. The selectors below were
 * rewritten to match.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Variation dialog from the public song page posts voice + raga overrides", async ({
  page,
}) => {
  await signIn(page);

  // Pick a public song that actually has a track row. The tightened
  // Discover query (v1.4 live-bug closeout 3.5) means only such songs
  // surface here, so the first card is fine.
  await page.goto("/discover");
  const firstPublic = page.locator('a[href^="/s/"]').first();
  const visibleCount = await firstPublic.count();
  test.skip(
    visibleCount === 0,
    "no published songs with tracks in this env; variation dialog requires a public song",
  );
  await firstPublic.waitFor({ state: "visible", timeout: 15_000 });
  await firstPublic.click();
  await page.waitForURL(/\/s\/[a-z0-9-]+/i, { timeout: 15_000 });

  const trigger = page
    .getByRole("button", { name: /make a variation/i })
    .first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();

  const distance = page.getByLabel(/distance from the original/i);
  await expect(distance).toBeVisible({ timeout: 5_000 });
  await distance.fill("65");

  // Tempo: now type="text" inputMode="numeric". The label is "Tempo (BPM)".
  await page.getByLabel(/^Tempo \(BPM\)/i).fill("104");

  // Voice dropdown: pick the first non-(inherit) option if any.
  const voiceSelect = page.getByTestId("fork-voice");
  await expect(voiceSelect).toBeVisible();
  const voiceOptions = voiceSelect.locator("option");
  const voiceOptionCount = await voiceOptions.count();
  let pickedVoiceId: string | null = null;
  if (voiceOptionCount > 1) {
    pickedVoiceId = await voiceOptions.nth(1).getAttribute("value");
    if (pickedVoiceId) {
      await voiceSelect.selectOption(pickedVoiceId);
    }
  }

  // Raga dropdown: only rendered for raga-aware families. If visible,
  // pick the first concrete option so the request carries raga_override.
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

  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/variation") &&
      r.request().method() === "POST",
    { timeout: 30_000 },
  );
  const submitButton = page
    .getByRole("button", { name: /make a variation/i })
    .nth(1);
  // Capture the request body before we await the response so we can
  // assert it carries voice_id / raga_override.
  const reqPromise = page.waitForRequest(
    (r) =>
      r.url().includes("/api/songs/") &&
      r.url().endsWith("/variation") &&
      r.method() === "POST",
    { timeout: 30_000 },
  );
  await submitButton.click();
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
    distance: 65,
  });
});
