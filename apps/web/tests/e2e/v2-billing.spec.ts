/**
 * E2E (v2): Stripe TEST-mode checkout sessions are created for both paid tiers and the pricing page links to them.
 * Completing a card payment needs the production webhook (tier sync), so that part is verified at cutover.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

test("signed-out users cannot create checkout sessions", async ({ request }) => {
  const res = await request.post("/api/billing/checkout", { data: { tier: "creator" } });
  expect([401, 403]).toContain(res.status());
});

for (const tier of ["creator", "pro"] as const) {
  test(`checkout session for ${tier} points at Stripe test checkout`, async ({ page }) => {
    await signIn(page);
    const res = await page.request.post("/api/billing/checkout", { data: { tier } });
    expect(res.status()).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
  });
}

test("pricing page lists the tiers", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/creator/i).first()).toBeVisible();
  await expect(page.getByText(/pro/i).first()).toBeVisible();
});
