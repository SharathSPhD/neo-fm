/**
 * E2E spec: upgrade / pricing surface (Sprint 7.3).
 *
 * Does NOT submit a real Stripe Checkout — that's covered by the
 * Sprint 5c smoke (`/tmp/smoke/upgrade-smoke.mjs`). This spec is the
 * fast contract regression test:
 *
 *   - /pricing renders for anonymous users with a sign-in CTA
 *   - /pricing renders for signed-in Free users with "Upgrade to
 *     Creator/Pro" buttons that hit /api/billing/checkout
 *   - /api/billing/checkout returns a Stripe URL or a 503
 *     (billing-disabled) — never a 5xx with an empty body
 *   - axe critical/serious violations: 0 on /pricing
 *
 * The smoke user is already on Creator (per Sprint 5c). For Free-tier
 * coverage we'd need a second fixture user; deferred to v1.3.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";
import { expectNoSeriousA11yViolations } from "./helpers/axe";

test("pricing renders for anonymous visitors", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "/pricing (anon)");
});

test("pricing renders for signed-in users with billing CTAs", async ({ page }) => {
  await signIn(page);
  await page.goto("/pricing");
  // The smoke user is already on Creator, so we see a "Manage
  // subscription" link (account link) and may still see an
  // "Upgrade to Pro" CTA. We assert at least one billing CTA
  // exists (manage OR upgrade) since the static "Join waitlist"
  // path is only for billing-disabled deployments.
  const ctas = page.getByRole("button", {
    name: /upgrade to (creator|pro)/i,
  });
  const manage = page.getByRole("link", { name: /manage subscription/i });
  await expect(async () => {
    const ctaCount = await ctas.count();
    const manageCount = await manage.count();
    expect(ctaCount + manageCount).toBeGreaterThan(0);
  }).toPass({ timeout: 10_000 });
  await expectNoSeriousA11yViolations(page, "/pricing (authed)");
});

test("POST /api/billing/checkout returns a Stripe session url or 503", async ({
  page,
}) => {
  await signIn(page);
  const out = await page.evaluate(async () => {
    const r = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "pro" }),
    });
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    return { status: r.status, body };
  });
  // Accept the two valid states: configured (200 + url) or disabled (503).
  expect([200, 303, 503]).toContain(out.status);
  if (out.status === 200 || out.status === 303) {
    expect(out.body).toMatchObject({
      url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//),
    });
  } else {
    expect(out.body).toMatchObject({ error: expect.any(String) });
  }
});
