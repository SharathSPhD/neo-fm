/**
 * v1.4 live-bug closeout — share dialog copy + Done button.
 *
 * Before 3.2, the share dialog (apps/web/app/(app)/songs/[id]/
 * share-button.tsx) referenced `/explore` (which doesn't exist) and
 * had no obvious affordance to dismiss the dialog besides a tiny ×.
 * The fix:
 *   - "Will show on /explore." -> "Will show on /discover."
 *   - Adds a bottom-right "Done" button that closes the dialog.
 *
 * This spec opens the Share dialog from /songs/:id and asserts:
 *   1. The Public option's description says "/discover" (not "/explore").
 *   2. A "Done" button is present.
 *   3. Clicking "Done" closes the dialog (the Public option is no
 *      longer visible).
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../helpers/auth";

test("Share dialog references /discover and has a Done button", async ({
  page,
}) => {
  await signIn(page);

  await page.goto("/library?status=completed&view=list", {
    waitUntil: "networkidle",
  });
  const songLink = page
    .locator(
      'a[href^="/songs/"]:not([href="/songs/new"]):not([href^="/songs/new"])',
    )
    .first();
  const hasSong = (await songLink.count()) > 0;
  test.skip(
    !hasSong,
    "test user has no completed songs; share dialog cannot be opened",
  );
  await songLink.click();
  await page.waitForURL(/\/songs\/[0-9a-f-]{36}/, { timeout: 15_000 });

  // The share trigger renders either "Share" or "Manage share"
  // depending on current visibility.
  const trigger = page
    .getByRole("button", { name: /^(Share|Manage share)$/i })
    .first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();

  // /discover copy is present; /explore is not.
  await expect(page.getByText(/Will show on \/discover\./i)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/Will show on \/explore\./i)).toHaveCount(0);

  // Done button is present and dismisses the dialog.
  const done = page.getByRole("button", { name: /^Done$/ });
  await expect(done).toBeVisible();
  await done.click();
  await expect(page.getByText(/Will show on \/discover\./i)).toHaveCount(0);
});
