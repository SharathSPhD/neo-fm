/**
 * Mobile layout and page-chrome regressions found by launch QA (#306, #307, #308).
 * Read-only, so it also runs in preview-URL mode.
 */
import { expect, test } from "@playwright/test";

const PHONES = [360, 375];
const PAGES = ["/", "/pricing", "/help", "/discover", "/ideas", "/templates", "/trust", "/terms", "/privacy", "/grievance"];

test.describe("no sideways scroll on small phones", () => {
  for (const width of PHONES) {
    for (const path of PAGES) {
      test(`${path} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 740 });
        await page.goto(path);
        await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(scroll).toBeLessThanOrEqual(client);
        // The primary call to action must sit fully inside the viewport.
        const box = await page.getByRole("link", { name: /get started/i }).first().boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      });
    }
  }
});

// #325: the header CTA overflowed by 4px in Telugu at 360px. Every UI language must fit.
test.describe("no sideways scroll at 360px in every UI language", () => {
  for (const lang of ["hi", "ta", "te", "kn", "bn", "mr"]) {
    for (const path of ["/", "/pricing", "/help", "/station"]) {
      test(`${lang} ${path}`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: "neo-fm-lang", value: lang, url: baseURL ?? "http://localhost:3000" }]);
        await page.setViewportSize({ width: 360, height: 740 });
        await page.goto(path);
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(scroll).toBeLessThanOrEqual(client);
      });
    }
  }
});

test.describe("page titles", () => {
  const TITLES: [string, RegExp][] = [
    ["/sign-in", /^Sign in -- neo-fm$/],
    ["/sign-up", /^Create your account -- neo-fm$/],
    ["/offline", /^You're offline -- neo-fm$/],
  ];
  for (const [path, title] of TITLES) {
    test(`${path} has its own title and description`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
    });
  }
});

test.describe("touch targets", () => {
  for (const path of ["/", "/discover", "/ideas"]) {
    test(`${path} controls are at least 32px tall`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("a[href], button, select, summary")]
          .filter((el) => !el.closest("p, li > span, .prose") || el.closest("nav, footer"))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.classList.contains("sr-only") && r.height < 32 && getComputedStyle(el).display !== "inline")
          .map(({ el, r }) => `${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`),
      );
      expect(small).toEqual([]);
    });
  }
});
