/**
 * Core-flow smoke. Selectors are role/text based and deliberately loose
 * (regexes, no CSS/test-ids) because onboarding UI is still moving.
 *
 * Local mode talks to tests/smoke/fake-supabase.mjs, so "queued" means the
 * app called create_song_job on the fake; nothing real is generated or
 * written. In preview-URL mode (SMOKE_BASE_URL) the specs that sign in or
 * write are skipped.
 */
import { expect, test, type Page } from "@playwright/test";

const REMOTE = Boolean(process.env.SMOKE_BASE_URL);
const FAKE = `http://127.0.0.1:${process.env.SMOKE_FAKE_SUPABASE_PORT ?? 54399}`;
const PUBLIC_ID = "smkpb23456";

async function fakeCalls(): Promise<{ method: string; path: string; body: unknown }[]> {
  const res = await fetch(`${FAKE}/__calls`);
  return res.json();
}

async function dismissOnboarding(page: Page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("neo-fm:library-onboarded", "1"); } catch { /* ignore */ }
  });
}

test.describe("public pages", () => {
  test("landing renders a hero and a sign-up call to action", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /first song|get started|sign up|create/i }).first()).toBeVisible();
  });

  test("pricing lists plans", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/free/i).first()).toBeVisible();
    await expect(page.getByText(/creator/i).first()).toBeVisible();
  });

  test("trust & safety page renders", async ({ page }) => {
    await page.goto("/trust");
    await expect(page.getByRole("heading", { level: 1, name: /trust/i })).toBeVisible();
  });

  test("protected routes bounce anonymous visitors to sign-in", async ({ page }) => {
    await page.goto("/songs/new");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("sign up", () => {
  test("form submits and asks the user to confirm their email", async ({ page }) => {
    test.skip(REMOTE, "writes an account; local fake backend only");
    await page.goto("/sign-up");
    await page.getByLabel(/email/i).fill("new-user@neo-fm.test");
    await page.getByLabel(/password/i).fill("Sm0ke-Test-Pass!");
    await page.getByRole("button", { name: /create account|sign up/i }).click();
    await expect(page.getByText(/confirmation link|check your inbox/i)).toBeVisible();
    const calls = await fakeCalls();
    expect(calls.some((c) => c.path === "/auth/v1/signup")).toBe(true);
  });
});

test.describe("create a song (up to queued)", () => {
  test("signed-in user submits a prompt and a job is queued", async ({ page }) => {
    test.skip(REMOTE, "signs in and creates a job; local fake backend only");
    await dismissOnboarding(page);

    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill("smoke@neo-fm.test");
    await page.getByLabel(/password/i).fill("Sm0ke-Test-Pass!");
    await page.getByRole("button", { name: /^sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));

    await page.goto("/songs/new");
    await expect(page.getByRole("heading", { name: /new song/i })).toBeVisible();
    await page
      .getByRole("textbox", { name: /describe|prompt|song/i })
      .first()
      .fill("A gentle Hindi lullaby about the monsoon rain");
    await page.getByRole("button", { name: /queue|generate|create|make|compose/i }).first().click();

    await expect(page.getByText(/queued/i).first()).toBeVisible();
    const calls = await fakeCalls();
    expect(calls.some((c) => c.path === "/rest/v1/rpc/create_song_job")).toBe(true);
  });
});

test.describe("public song page + report", () => {
  test("shows the song and accepts a report", async ({ page }) => {
    test.skip(REMOTE, "needs the seeded fake song; reporting writes");
    await page.goto(`/s/${PUBLIC_ID}`);
    await expect(page.getByText(/smoke test song/i).first()).toBeVisible();

    await page.getByRole("button", { name: /report this song/i }).click();
    await page.getByRole("button", { name: /send report/i }).click();
    await expect(page.getByRole("status")).toContainText(/thanks/i);

    const calls = await fakeCalls();
    expect(calls.some((c) => c.path === "/rest/v1/song_reports")).toBe(true);
  });

  test("report UI is reachable on a missing song without crashing", async ({ page }) => {
    const res = await page.goto("/s/zzzzzzzzzz");
    expect(res?.status()).toBe(404);
  });
});
