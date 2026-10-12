/**
 * PR-time axe gate: WCAG 2.1 A/AA on the public pages, in both themes,
 * with colour-contrast ENABLED (the nightly e2e helper disables it).
 * Fails on any critical or serious violation.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/pricing", "/trust", "/privacy", "/terms", "/help", "/sign-in", "/sign-up"];
const THEMES = ["dark", "light"] as const;

for (const theme of THEMES) {
  for (const path of PAGES) {
    test(`axe: ${path} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
        } catch {
          /* storage may be blocked */
        }
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      const summary = serious.map(
        (v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`,
      );
      expect(summary, `axe violations on ${path} (${theme})`).toEqual([]);
    });
  }
}
