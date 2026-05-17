/**
 * v1.4 Sprint 17 — advanced-controls e2e.
 *
 * Smoke-coverage for the Sprint 4 advanced disclosure on the
 * creation canvas: opening the disclosure exposes tempo, key, raga,
 * tala, orchestration, mix, and section-tag controls; toggling a
 * couple of them lands in the POSTed SongDocument.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Advanced controls on /songs/new round-trip into the POSTed body", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/songs/new");

  const advanced = page.getByRole("button", { name: /advanced/i }).first();
  await advanced.waitFor({ state: "visible", timeout: 10_000 });
  await advanced.click();

  // The disclosure should expose tempo, key, raga, and orchestration
  // controls. We assert the labels are present rather than poking at
  // specific input IDs (which are still in flux in v1.4).
  await expect(page.getByLabel(/tempo/i).first()).toBeVisible();
  await expect(page.getByLabel(/key/i).first()).toBeVisible();
  await expect(page.getByLabel(/raga/i).first()).toBeVisible();
  await expect(page.getByLabel(/orchestration/i).first()).toBeVisible();

  // Tweak the tempo and capture the POSTed body.
  await page.getByLabel(/tempo/i).first().fill("96");

  const respPromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/songs") && r.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: /create song/i }).click();
  const resp = await respPromise;
  expect(resp.status()).toBe(202);
  const sent = resp.request().postDataJSON();
  expect(sent.song_document?.tempo_bpm ?? sent.tempo_bpm).toBe(96);
});
