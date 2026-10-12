/**
 * E2E (v2): what a signed-out visitor sees — the Listen-first strip, Discover, and a public song page with
 * playable audio, the AI-generated disclosure and the Pro call-to-action.
 */
import { expect, test } from "@playwright/test";

test("landing has a Listen-first strip linking to public songs", async ({ page }) => {
  await page.goto("/");
  const links = page.locator('a[href^="/s/"]');
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThanOrEqual(3);
});

test("public song page: audio, lyrics, AI disclosure, Pro CTA", async ({ page }) => {
  await page.goto("/discover");
  const first = page.locator('a[href^="/s/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/s\/[a-z0-9]+/);
  await expect(page.locator("audio")).toHaveCount(1);
  await expect(page.getByText(/AI-generated/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /pro/i }).first()).toBeVisible();
});

test("trust page states the responsible-AI commitments", async ({ page }) => {
  await page.goto("/trust");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/Technektar/i).first()).toBeVisible();
});

test("privacy and terms pages exist and are linked from the footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Privacy" }).first()).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: /privacy/i })).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: /terms/i })).toBeVisible();
});

test("sign-in/up forms cannot submit credentials natively before hydration (no password in the URL)", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: baseURL ?? undefined, extraHTTPHeaders: {} });
  const page = await ctx.newPage();
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page.locator("form button[type=submit]").first()).toBeDisabled();
    await expect(page.locator("form").first()).toHaveAttribute("method", /post/i);
  }
  await ctx.close();
});
