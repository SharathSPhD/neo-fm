/**
 * Station critical path, signed out: play, skip, the sign-up card after three tracks, the steering chips' active state,
 * and "no signal writes while signed out".
 *
 * Local mode (what CI runs) plays six silent WAV tracks served by tests/smoke/fake-supabase.mjs. In preview-URL mode
 * (SMOKE_BASE_URL) it reads the real pool; a signed-out visitor never writes anything, which is also what the last
 * test asserts, so nothing is written to the shared environment.
 */
import { expect, test, type Page } from "@playwright/test";

const REMOTE = Boolean(process.env.SMOKE_BASE_URL);
const FAKE = `http://127.0.0.1:${process.env.SMOKE_FAKE_SUPABASE_PORT ?? 54399}`;

const audio = (page: Page) => page.locator("audio").first();
const src = (page: Page) => page.evaluate(() => document.querySelector("audio")?.getAttribute("src") ?? "");

/** Open the station as a first-time visitor and press Start; skips the test when the pool is empty. */
async function startStation(page: Page) {
  await page.goto("/station");
  await expect(page.getByRole("heading", { name: "Station", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /start my station/i }).click();
  const nothing = page.getByText(/nothing to play yet/i);
  const loaded = audio(page);
  await expect(loaded.or(nothing)).toBeVisible();
  test.skip(await nothing.isVisible(), "station pool is empty in this environment");
  await expect.poll(() => src(page)).not.toBe("");
}

/** Click Skip and wait until a different track is loaded. */
async function skip(page: Page) {
  const before = await src(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect.poll(async () => {
    const now = await src(page);
    return now !== "" && now !== before;
  }).toBe(true);
}

// Local mode serves audio from the fake backend over http://localhost, which the app's production CSP (media-src https:)
// rightly refuses; bypass it for this spec only. Against a preview the real https signed URLs go through the real CSP.
test.use({ bypassCSP: !REMOTE });

test.describe("station (signed out)", () => {
  test("plays a track and shows what is playing", async ({ page }) => {
    await startStation(page);
    await expect.poll(() => page.evaluate(() => { const a = document.querySelector("audio"); return !!a && !a.paused; })).toBe(true);
    await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(like|liked)$/i })).toBeVisible();
  });

  test("skip moves to a different track", async ({ page }) => {
    await startStation(page);
    await skip(page);
    await expect.poll(() => page.evaluate(() => { const a = document.querySelector("audio"); return !!a && !a.paused; })).toBe(true);
  });

  test("shows the sign-up card after three tracks and playback keeps going", async ({ page }) => {
    await startStation(page);
    await expect(page.getByText(/enjoying the station/i)).toHaveCount(0);
    await skip(page);
    await skip(page);
    await expect(page.getByText(/enjoying the station/i)).toHaveCount(0);
    await skip(page);
    await expect(page.getByText(/enjoying the station/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up free/i })).toHaveAttribute("href", "/sign-up?next=%2Fstation");
    await expect(audio(page)).toBeVisible();
  });

  test("steering and language chips show their active state", async ({ page }) => {
    await startStation(page);
    const calmer = page.getByRole("button", { name: "Calmer", exact: true });
    const livelier = page.getByRole("button", { name: "Livelier", exact: true });
    await expect(calmer).toHaveAttribute("aria-pressed", "false");

    await calmer.click();
    await expect(calmer).toHaveAttribute("aria-pressed", "true");
    await expect(livelier).toHaveAttribute("aria-pressed", "false");

    await livelier.click();
    await expect(livelier).toHaveAttribute("aria-pressed", "true");
    await expect(calmer).toHaveAttribute("aria-pressed", "false");

    await livelier.click();
    await expect(livelier).toHaveAttribute("aria-pressed", "false");

    // Chips carry the language's own name since #215 (not the code), whatever the site language.
    const language = page.getByRole("group", { name: "Language" });
    await expect(language.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    await language.getByRole("button", { name: "हिन्दी", exact: true }).click();
    await expect(language.getByRole("button", { name: "हिन्दी", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(language.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });

  test("sends no listener signals while signed out", async ({ page }) => {
    const signalPosts: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/station/signal")) signalPosts.push(`${r.method()} ${r.url()}`);
    });
    await startStation(page);
    await page.getByRole("button", { name: /^like$/i }).click();
    await page.getByRole("button", { name: "Replay", exact: true }).click();
    await skip(page);
    await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeVisible();
    expect(signalPosts).toEqual([]);

    if (!REMOTE) {
      const calls = (await (await fetch(`${FAKE}/__calls`)).json()) as { method: string; path: string }[];
      expect(calls.filter((c) => c.path.includes("station_signals"))).toEqual([]);
    }
  });
});
