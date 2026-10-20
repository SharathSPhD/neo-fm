/**
 * Smoke for the newer public surfaces: dedication, embed, share cards and
 * non-Latin lyrics. Backed by the fixtures in fixtures.mjs, so local mode only.
 * Collections and insights are not merged yet; add them here when they land.
 */
import { expect, test } from "@playwright/test";

import { DEDICATED, SONG_FIXTURES } from "./fixtures.mjs";

test.skip(Boolean(process.env.SMOKE_BASE_URL), "needs the seeded fake songs");

test.describe("dedication", () => {
  test("a dedicated song shows who it is for and is kept out of search", async ({ page }) => {
    await page.goto(`/s/${DEDICATED.publicId}`);
    const banner = page.getByRole("region", { name: /dedication/i });
    await expect(banner).toContainText(DEDICATED.to);
    await expect(banner).toContainText(/Kochi/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("an undedicated public song has no dedication banner", async ({ page }) => {
    await page.goto(`/s/${SONG_FIXTURES.en.publicId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: /dedication/i })).toHaveCount(0);
  });

  test("the story card renders as a PNG for public songs and 404s otherwise", async ({ request }) => {
    const ok = await request.get(`/s/${DEDICATED.publicId}/story`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toContain("image/png");
    expect(ok.headers()["x-robots-tag"]).toContain("noindex");
    expect((await request.get("/s/zzzzzzzzzz/story")).status()).toBe(404);
  });

  test("the link-preview image renders", async ({ request }) => {
    const res = await request.get(`/s/${DEDICATED.publicId}/opengraph-image`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });
});

test.describe("embed", () => {
  test("renders a bare player view that may be framed", async ({ page }) => {
    const res = await page.goto(`/s/${SONG_FIXTURES.hi.publicId}/embed`);
    expect(res?.status()).toBe(200);
    // Embeddable: no X-Frame-Options, and frame-ancestors is open.
    expect(res?.headers()["x-frame-options"]).toBeUndefined();
    expect(res?.headers()["content-security-policy"]).toMatch(/frame-ancestors \*/);
    await expect(page.getByText("बारिश की पहली बूँद").first()).toBeVisible();
  });

  test("the full song page may be framed only by itself and Telegram Web", async ({ request }) => {
    const res = await request.get(`/s/${SONG_FIXTURES.hi.publicId}`);
    // X-Frame-Options cannot name Telegram Web, so it is dropped in favour of CSP frame-ancestors.
    expect(res.headers()["x-frame-options"]).toBeUndefined();
    const csp = res.headers()["content-security-policy"] ?? "";
    const ancestors = /frame-ancestors ([^;]+)/.exec(csp)?.[1]?.split(" ");
    expect(ancestors).toEqual([
      "'self'",
      "https://web.telegram.org",
      "https://webk.telegram.org",
      "https://webz.telegram.org",
    ]);
  });

  test("an unknown song 404s", async ({ request }) => {
    expect((await request.get("/s/zzzzzzzzzz/embed")).status()).toBe(404);
  });
});

test.describe("lyrics in their own script", () => {
  const TITLES = {
    hi: "बारिश की पहली बूँद",
    ta: "முதல் மழைத்துளி",
    te: "తొలి వాన చినుకు",
    kn: "ಮೊದಲ ಮಳೆಹನಿ",
    bn: "প্রথম বৃষ্টির ফোঁটা",
  } as const;
  for (const [lang, title] of Object.entries(TITLES)) {
    test(`${lang} song page renders the title and lyrics in script`, async ({ page }) => {
      await page.goto(`/s/${SONG_FIXTURES[lang as keyof typeof SONG_FIXTURES].publicId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByText(title.split(" ")[0]!).first()).toBeVisible();
    });
  }
});
