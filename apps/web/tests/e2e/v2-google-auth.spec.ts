/**
 * E2E (v2): "Continue with Google" reaches Google's sign-in for OUR client with the right return address.
 * We cannot complete a real Google login in CI; this catches provider-disabled and redirect-URI misconfiguration.
 */
import { expect, test } from "@playwright/test";

test("continue with Google redirects to accounts.google.com with our callback", async ({ page }) => {
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /continue with google/i }).click();
  await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 });
  // Google nests our return URL inside opaque params with a varying number of encoding layers; decode until stable.
  let flat = page.url();
  for (let i = 0; i < 5; i++) { const d = decodeURIComponent(flat); if (d === flat) break; flat = d; }
  expect(flat).toMatch(/https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/callback/); // Supabase's callback registered in our Google client
  expect(flat).toContain("/auth/callback"); // our app's return path
  expect(flat).toContain("client_id=");
  await expect(page.locator("body")).not.toContainText(/redirect_uri_mismatch|invalid_client|access blocked/i);
});
