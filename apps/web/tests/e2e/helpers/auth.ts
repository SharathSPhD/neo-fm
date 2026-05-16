/**
 * Shared sign-in helper used by every e2e spec.
 *
 * Default credentials point at the long-lived `e2e-smoke@neo-fm.test`
 * user (Creator tier from Sprint 5c). Override via env if running
 * against a staging DB with a different seed user.
 *
 * We pre-flag the library onboarding modal via addInitScript so the
 * `<LibraryOnboardingModal>` overlay doesn't intercept clicks on the
 * first authed pageload. Real users dismiss it manually; e2e suites
 * shouldn't need to.
 */
import { expect, type Page } from "@playwright/test";

export const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e-smoke@neo-fm.test";
export const E2E_PASSWORD =
  process.env.E2E_USER_PASSWORD ?? "SmokeTest!v12";

export async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("neo-fm:library-onboarded", "1");
    } catch {
      // private mode etc — fine; the modal will fire and have to be
      // dismissed by the spec.
    }
  });
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  const [resp] = await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), {
      timeout: 30_000,
    }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  // Belt-and-braces: confirm we left the sign-in page.
  expect(page.url()).not.toContain("/sign-in");
  return resp as unknown as void;
}
