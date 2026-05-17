/**
 * v1.4 Sprint 5 — E2E spec for the Voice picker on /songs/new.
 *
 * Covers:
 *   - the picker is rendered with the language-default "Auto" row
 *   - clicking a voice row stamps the voice_id in the live preview
 *   - submitting POSTs a body whose `voice_id` matches the selection
 *
 * The 10s WAV preview is *not* exercised end-to-end here because the
 * test fixtures don't ship media; we cover the play/stop interaction
 * in the targeted picker unit tests (Sprint 5b will add a real audio
 * fixture once preview hosting lands).
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

test("Voice picker selection lands in the POSTed SongDocument", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/songs/new");

  // The picker section is visible without any extra disclosure click.
  const picker = page.getByTestId("voice-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("voice-row-auto")).toBeVisible();

  // Default language on `/songs/new` is Hindi (DEFAULT_FORM.language).
  // The "Suggested for HI" group should include the broadcast-male
  // and lyrical-female personas.
  await expect(page.getByText(/suggested for HI/i)).toBeVisible();

  // Pick the lyrical-female persona.
  const row = page.getByTestId("voice-row-indic_hi_female_lyrical");
  await row.locator('input[type="radio"]').click();

  // The live JSON preview should now contain the chosen voice_id.
  // The preview component owned by the Advanced disclosure is
  // collapsed by default; expand it so we can read its contents.
  await page.getByRole("button", { name: /^Advanced$/i }).click();
  const preview = page.getByLabel(/Song document JSON preview/i);
  await expect(preview).toContainText("indic_hi_female_lyrical");

  // Submit and capture the POST body.
  const reqPromise = page.waitForRequest(
    (r) => r.url().endsWith("/api/songs") && r.method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /Queue song/i }).click();
  const req = await reqPromise;
  const body = JSON.parse(req.postData() ?? "{}");
  expect(body.song_document.voice_id).toBe("indic_hi_female_lyrical");
});

test("Clearing the voice selection removes voice_id from the POST body", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/songs/new");

  // Pick something first.
  await page
    .getByTestId("voice-row-indic_hi_male_broadcast")
    .locator('input[type="radio"]')
    .click();
  await expect(page.getByText(/^Clear$/)).toBeVisible();

  // Then clear.
  await page.getByText(/^Clear$/).click();

  // Submit and confirm voice_id is absent.
  const reqPromise = page.waitForRequest(
    (r) => r.url().endsWith("/api/songs") && r.method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /Queue song/i }).click();
  const req = await reqPromise;
  const body = JSON.parse(req.postData() ?? "{}");
  expect(body.song_document.voice_id).toBeUndefined();
});
