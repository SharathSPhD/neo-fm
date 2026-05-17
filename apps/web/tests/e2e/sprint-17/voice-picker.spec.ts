/**
 * v1.4 Sprint 17 — voice-picker e2e.
 *
 * Smoke-coverage for the v1.4 voice catalogue: changing the language
 * pivots the "Suggested for …" group, the language-default "Auto" row
 * is always present, and the selected voice_id round-trips into the
 * POSTed body. Complements the original Sprint-5 voice-picker spec by
 * exercising at least two language pivots in a single session.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Voice picker pivots on language change and stamps voice_id", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/songs/new");

  const picker = page.getByTestId("voice-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("voice-row-auto")).toBeVisible();

  // Pivot to Kannada and assert at least one "Suggested for KN" row
  // shows; the catalogue ships ≥2 Kannada personas.
  await page.getByLabel(/language/i).first().selectOption("kn");
  await expect(
    page.getByText(/suggested for kn/i),
  ).toBeVisible({ timeout: 5_000 });

  // Pivot back to Hindi and pick the first non-Auto suggested row.
  await page.getByLabel(/language/i).first().selectOption("hi");
  const firstSuggested = page
    .locator('[data-testid^="voice-row-"]:not([data-testid="voice-row-auto"])')
    .first();
  await firstSuggested.waitFor({ state: "visible", timeout: 5_000 });
  const expectedVoiceId = await firstSuggested.getAttribute("data-voice-id");
  await firstSuggested.click();

  // Confirm the body POSTed has the same voice_id.
  const respPromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/songs") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /create song/i }).click();
  const resp = await respPromise;
  expect(resp.status()).toBe(202);
  const req = resp.request().postDataJSON();
  if (expectedVoiceId) {
    expect(req.voice_id).toBe(expectedVoiceId);
  }
});
