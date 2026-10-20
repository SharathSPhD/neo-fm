/** Signs in once against the fake backend and stores the session for the visual specs. */
import { expect, test as setup } from "@playwright/test";

const STATE = "tests/visual/.auth/state.json";

setup("sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill("smoke@neo-fm.test");
  await page.getByLabel(/password/i).fill("Sm0ke-Test-Pass!");
  await page.getByRole("button", { name: /^sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
  await expect(page).not.toHaveURL(/sign-in/);
  await page.context().storageState({ path: STATE });
});
