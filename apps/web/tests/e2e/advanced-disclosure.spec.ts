/**
 * v1.4 Sprint 4 — E2E spec for the Advanced disclosure on /songs/new.
 *
 * Covers:
 *   - the section is collapsed by default
 *   - expanding reveals the tempo / key / raga / mix controls
 *   - filling tempo + density updates the live SongDocument JSON
 *     preview block
 *   - submitting POSTs a body whose tempo_bpm and background_mix match
 *     what the user typed
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

test("Advanced disclosure expands + folds into the SongDocument we POST", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/songs/new");

  // The Advanced disclosure is rendered, but the controls section is
  // collapsed by default — `aria-expanded` flips on click.
  const trigger = page.getByRole("button", { name: /^Advanced$/i });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // Fill tempo (the first numeric input in the disclosure).
  await page.locator('input[type="number"]').first().fill("125");

  // Pick a density radio.
  await page.getByRole("radio", { name: /dense/i }).click();

  // The JSON preview should now contain the tempo and density.
  const preview = page.getByLabel(/Song document JSON preview/i);
  await expect(preview).toContainText("125");
  await expect(preview).toContainText("dense");

  // Submit and capture the POST body. Don't actually wait for the
  // job-detail page; the API submit is what we care about.
  const reqPromise = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/songs") && r.method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /Queue song/i }).click();
  const req = await reqPromise;
  const body = JSON.parse(req.postData() ?? "{}");
  expect(body.song_document.tempo_bpm).toBe(125);
  expect(body.song_document.background_mix).toMatchObject({
    accompaniment_density: "dense",
  });
});
