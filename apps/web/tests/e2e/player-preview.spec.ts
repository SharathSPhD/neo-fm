/**
 * Persistent player, Media Session, data saver and PWA manifest checks on
 * the dev-only /dev-preview harness (skips itself where it 404s). Run:
 *   E2E_BASE_URL=http://localhost:3000 pnpm playwright test player-preview
 * SHOTS=1 writes screenshots to tests/e2e/.screens/.
 */
import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./helpers/axe";

test.use({ viewport: { width: 375, height: 800 } });

test.beforeEach(async ({ page }) => {
  const res = await page.goto("/dev-preview", { waitUntil: "networkidle" });
  test.skip(res?.status() === 404, "dev-preview is disabled in production builds");
});

test("playback survives navigation and shows the mini-player", async ({ page }) => {
  await page.getByTestId("song-play").click();
  await expect.poll(() => page.evaluate(() => !document.querySelector<HTMLAudioElement>("audio[data-global-player]")!.paused)).toBe(true);

  await page.getByRole("link", { name: "Go to another page" }).click();
  await expect(page).toHaveURL(/\/dev-preview\/other/);
  const mini = page.getByTestId("mini-player");
  await expect(mini).toBeVisible();

  const t1 = await page.evaluate(() => document.querySelector<HTMLAudioElement>("audio[data-global-player]")!.currentTime);
  await page.waitForTimeout(1200);
  const t2 = await page.evaluate(() => document.querySelector<HTMLAudioElement>("audio[data-global-player]")!.currentTime);
  expect(t2).toBeGreaterThan(t1);
  if (process.env.SHOTS) await page.screenshot({ path: "tests/e2e/.screens/mini-player-mobile.png" });
  await expectNoSeriousA11yViolations(page, "mini-player");

  await mini.getByRole("button", { name: /pause/i }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLAudioElement>("audio[data-global-player]")!.paused)).toBe(true);
  await mini.getByRole("button", { name: /close player/i }).click();
  await expect(mini).toHaveCount(0);
});

test("media session metadata is published for the lock screen", async ({ page }) => {
  await page.getByTestId("song-play").click();
  const meta = await page.evaluate(() => {
    const m = navigator.mediaSession.metadata;
    return m ? { title: m.title, artist: m.artist, art: m.artwork.length } : null;
  });
  expect(meta).toMatchObject({ title: "बारिश की पहली बूँद", artist: "Hindustani · Hindi" });
  expect(meta!.art).toBeGreaterThan(0);
});

test("data saver stops audio preloading and hides the visualiser", async ({ page }) => {
  const audio = page.locator("audio[data-global-player]");
  await expect(audio).toHaveAttribute("preload", "metadata");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByLabel("Data saver").check();
  await expect(audio).toHaveAttribute("preload", "none");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Data saver")).toBeChecked(); // persisted
});

test("manifest is installable and its icons resolve", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  for (const icon of m.icons as { src: string }[]) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
  }
  expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  void page;
});

test("a failing audio URL is retried a bounded number of times, then shows an error", async ({ page }) => {
  let refreshCalls = 0;
  await page.route("**/api/songs/demo/audio-url", (route) => {
    refreshCalls += 1;
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' });
  });
  await page.evaluate(() => {
    const a = document.querySelector<HTMLAudioElement>("audio[data-global-player]")!;
    a.src = "/definitely-missing.mp3";
    a.load();
  });
  await expect(page.getByRole("alert").filter({ hasText: /couldn.t play/i }).first()).toBeVisible({ timeout: 15_000 });
  const settled = refreshCalls;
  await page.waitForTimeout(5000);
  expect(refreshCalls).toBe(settled);
  expect(settled).toBeLessThanOrEqual(2);
});
