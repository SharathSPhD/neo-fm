/**
 * E2E (v2, slow): the real user journey with NO manual polling — create a song through the UI, land on the song
 * page, watch the live timeline, and get a playable track. This is the test that would have caught "stuck on
 * processing because nothing polled". Enable with E2E_SLOW=1 (consumes a little Claude + Lyria budget).
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

test.skip(!process.env.E2E_SLOW, "slow: set E2E_SLOW=1");
test.setTimeout(12 * 60_000);

test("create a song and watch it finish on its own", async ({ page }) => {
  await signIn(page);
  await page.goto("/songs/new", { waitUntil: "networkidle" });
  await page.getByText("Describe with AI").click();
  await page.locator("textarea[name=prompt]").fill("A short Kannada bhavageete about the first monsoon rain, with harmonium and flute");
  await page.selectOption("#prompt-style", "kannada-light-classical");
  await page.selectOption("#prompt-language", { label: "Kannada" });
  await page.selectOption("#prompt-duration", { label: "30 seconds" });
  const created = page.waitForResponse((r) => r.url().includes("/api/songs") && r.request().method() === "POST");
  await page.getByRole("button", { name: /describe & queue/i }).click();
  const jobId = ((await (await created).json()) as { job_id: string }).job_id;

  await page.goto(`/songs/${jobId}`);
  await expect(page.getByText(/Writing lyrics|Warming up|Composing the music/)).toBeVisible({ timeout: 30_000 });
  // No fetches from the test: the page itself must drive the job to completion.
  await expect(page.locator("audio")).toHaveCount(1, { timeout: 10 * 60_000 });
  await expect(page.getByText(/completed/i).first()).toBeVisible();
});
