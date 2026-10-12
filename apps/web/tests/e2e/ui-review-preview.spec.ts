/**
 * Reviewer UI for translated strings, on the dev-only /dev-preview/ui-review harness (no database; the save
 * endpoint is mocked). Run: E2E_BASE_URL=http://localhost:3000 pnpm playwright test ui-review-preview
 * SHOTS=1 writes screenshots to tests/e2e/.screens/.
 */
import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./helpers/axe";

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  const res = await page.goto("/dev-preview/ui-review", { waitUntil: "networkidle" });
  test.skip(res?.status() === 404, "dev-preview is disabled in production builds");
});

test("shows English source, current translation and screen context", async ({ page }) => {
  const row = page.getByTestId("review-row").first();
  await expect(row.getByText("English")).toBeVisible();
  await expect(row.getByText(/Current kn translation/)).toBeVisible();
  await expect(page.getByRole("link", { name: /See this screen in kn/ }).first()).toHaveAttribute("href", /\/ui-review\/preview-token\/open\?path=/);
  if (process.env.SHOTS) await page.screenshot({ path: "tests/e2e/.screens/ui-review.png" });
});

test("approving and editing record verdicts and update progress", async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await page.route("**/api/ui-review/preview-token/items", async (route) => {
    saved.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  const progress = page.getByTestId("progress");
  await expect(progress).toContainText("0 of");

  await page.getByRole("button", { name: "Looks good" }).first().click();
  await expect(progress).toContainText("1 of");
  expect(saved[0]).toMatchObject({ action: "approve" });

  await page.getByLabel("Show", { exact: true }).selectOption("all");
  const second = page.getByTestId("review-row").nth(1);
  await second.getByLabel("Your version", { exact: true }).fill("ಹೊಸ ಅನುವಾದ");
  await expect(second.getByRole("button", { name: "Looks good" })).toBeDisabled();
  await second.getByRole("button", { name: "Save my edit" }).click();
  await expect(progress).toContainText("2 of");
  await expect(progress).toContainText("1 edited");
  expect(saved[1]).toMatchObject({ action: "edit", suggestion: "ಹೊಸ ಅನುವಾದ" });
});

test("blocks an edit that drops a {placeholder}", async ({ page }) => {
  await page.getByLabel("Search strings").fill("palette.noMatches");
  await page.getByLabel("Show", { exact: true }).selectOption("all");
  const row = page.getByTestId("review-row").first();
  await row.getByLabel("Your version", { exact: true }).fill("ಏನೂ ಸಿಗಲಿಲ್ಲ");
  await expect(row.getByRole("alert")).toBeVisible();
  await expect(row.getByRole("button", { name: "Save my edit" })).toBeDisabled();
});

test("no overflow and no serious a11y violations", async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectNoSeriousA11yViolations(page);
});
