/**
 * Visual regression. One full-page screenshot per (page, UI language,
 * viewport, theme). Fixtures are fixed copy with fixed dates (see
 * tests/smoke/fixtures.mjs), so a diff means the UI moved: broken Indic
 * shaping, text overflow, a collapsed layout or a theme token gone wrong.
 *
 * Besides the pixel comparison every page also asserts "no horizontal
 * overflow", which catches layout breakage even before a baseline exists.
 */
import { expect, test, type Page } from "@playwright/test";

import { DEDICATED, SONG_FIXTURES } from "../smoke/fixtures.mjs";

const AUTH_STATE = "tests/visual/.auth/state.json";

const UI_LANGS = ["en", "hi", "ta", "te", "kn", "bn"] as const;
type Lang = (typeof UI_LANGS)[number];

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
const THEMES = ["light", "dark"] as const;

async function prime(page: Page, theme: string, lang: Lang) {
  await page.clock.setFixedTime(new Date("2026-06-01T12:00:00Z"));
  await page.addInitScript(
    ([t, l]) => {
      try {
        window.localStorage.setItem("neo-fm:theme", t);
        window.localStorage.setItem("neo-fm:ui-lang", l);
        window.localStorage.setItem("neo-fm:library-onboarded", "1");
      } catch {
        /* storage blocked: the page falls back to its defaults */
      }
    },
    [theme, lang] as const,
  );
}

async function settle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);
}

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of THEMES) {
    test.describe(`${vpName} / ${theme}`, () => {
      test.use({ viewport });

      // Public pages, English chrome.
      for (const [name, path] of [
        ["landing", "/"],
        ["pricing", "/pricing"],
        ["trust", "/trust"],
        ["sign-in", "/sign-in"],
      ] as const) {
        test(`${name}`, async ({ page }) => {
          await prime(page, theme, "en");
          await settle(page, path);
          await expect(page).toHaveScreenshot(`${name}-en-${vpName}-${theme}.png`, { fullPage: true });
        });
      }

      // Public song page: the song's own script is the thing under test, so it
      // runs once per language with the UI language set to match.
      for (const lang of UI_LANGS) {
        test(`song page ${lang}`, async ({ page }) => {
          await prime(page, theme, lang);
          await settle(page, `/s/${SONG_FIXTURES[lang].publicId}`);
          await expect(page).toHaveScreenshot(`song-${lang}-${vpName}-${theme}.png`, { fullPage: true });
        });
      }

      test("song page with a dedication", async ({ page }) => {
        await prime(page, theme, "en");
        await settle(page, `/s/${DEDICATED.publicId}`);
        await expect(page).toHaveScreenshot(`song-dedication-en-${vpName}-${theme}.png`, { fullPage: true });
      });

      test("embed", async ({ page }) => {
        await prime(page, theme, "hi");
        await settle(page, `/s/${SONG_FIXTURES.hi.publicId}/embed`);
        // The no-audio notice appears after hydration; wait for it so the shot is not racy.
        await expect(page.getByText(/audio preview not available/i)).toBeVisible();
        await expect(page).toHaveScreenshot(`embed-hi-${vpName}-${theme}.png`, { fullPage: true });
      });

      // Signed-in app pages: localized chrome, one shot per UI language.
      test.describe("signed in", () => {
        test.use({ storageState: AUTH_STATE });
        for (const lang of UI_LANGS) {
          for (const [name, path] of [
            ["library", "/library"],
            ["create", "/songs/new"],
          ] as const) {
            test(`${name} ${lang}`, async ({ page }) => {
              await prime(page, theme, lang);
              await settle(page, path);
              await expect(page).toHaveScreenshot(`${name}-${lang}-${vpName}-${theme}.png`, { fullPage: true });
            });
          }
        }
      });
    });
  }
}
