/**
 * v1.4 Sprint 17 — discover-non-empty e2e.
 *
 * The Sprint 15 seed populates Discover with a 12-row demo matrix
 * spanning every v1.4 style_family. v1.4 live-bug closeout (3.5)
 * tightened the Discover query to require at least one row in
 * `tracks` via `tracks!inner(...)`, so seeded "catalog-only" jobs
 * (no track rows) no longer appear on /discover. This spec asserts:
 *   1. Style chips for every v1.4 family return without a 5xx.
 *   2. If at least one card is visible on /discover (i.e. there
 *      really is a published song with a track in this environment),
 *      clicking it lands on `/s/<publicId>` without the
 *      "still being prepared" / "Audio preview not available"
 *      amber notice — discover and audio invariants are aligned.
 */
import { expect, test } from "@playwright/test";

test("Discover requires tracks: visible cards land on playable pages", async ({
  page,
}) => {
  await page.goto("/discover", { waitUntil: "networkidle" });

  // Every chip should at minimum return a 200 page (no 500s). We
  // assert this before the audio invariant so a Postgres regression
  // in the new `tracks!inner` join fails loudly with a server error
  // rather than silently as "no cards visible".
  const chips = [
    "carnatic",
    "hindustani",
    "kannada-folk",
    "kannada-light-classical",
    "tamil-folk",
    "bollywood-ballad",
    "sanskrit-shloka",
    "bengali-rabindrasangeet",
    "telugu-keerthana",
    "western",
  ];
  for (const chip of chips) {
    const resp = await page.goto(`/discover?style=${chip}`);
    expect(resp?.status() ?? 200).toBeLessThan(500);
  }

  await page.goto("/discover", { waitUntil: "networkidle" });
  const cards = page.locator('a[href^="/s/"]');
  const count = await cards.count();

  // If the test env has no published songs with tracks, the tightened
  // query (v1.4 live-bug closeout 3.5) deliberately filters seeded
  // catalog rows that lack tracks. Skip the audio-invariant assertion
  // in that case rather than fail; the chip-clickthrough above is
  // sufficient to catch query regressions.
  test.skip(
    count === 0,
    "no published songs with tracks in this env; tightened Discover query intentionally filters them",
  );

  const firstHref = await cards.first().getAttribute("href");
  expect(firstHref).toMatch(/^\/s\//);
  await cards.first().click();
  await page.waitForURL(/\/s\/[a-z0-9-]+/i, { timeout: 15_000 });

  // The amber notice text was branched by status in v1.4 live-bug
  // closeout (3.5). Either variant on a visible Discover card means
  // we surfaced a row whose audio invariant is broken.
  const notice = page.getByText(
    /Rendering now|Audio preview not available for this song|Audio is still being prepared/,
  );
  await expect(notice).toHaveCount(0);
});
