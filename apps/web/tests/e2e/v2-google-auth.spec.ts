/**
 * E2E (v2): "Continue with Google" reaches Google's sign-in for OUR client with the right return address.
 * We cannot complete a real Google login in CI; this catches provider-disabled and redirect-URI misconfiguration.
 */
import { expect, test } from "@playwright/test";

test("continue with Google redirects to accounts.google.com with our callback", async ({ page }) => {
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /continue with google/i }).click();
  await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 });
  const url = decodeURIComponent(decodeURIComponent(page.url()));
  expect(url).toContain("/auth/callback");
  expect(page.url()).toContain("client_id=");
  await expect(page.locator("body")).not.toContainText(/redirect_uri_mismatch|invalid_client|access blocked/i);
});
