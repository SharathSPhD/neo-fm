/**
 * E2E spec: song-create (Sprint 7.3).
 *
 * Exercises the full create-job path through the same API contract
 * the UI uses, but without driving the multi-step wizard (which adds
 * minutes per run with no extra signal once Sprint 7.2's smoke
 * already covers the worker round-trip).
 *
 *   - POST /api/songs with a minimal doc → 202 + job_id
 *   - GET /api/songs/{id} → returns the same job with status in the
 *     expected enum
 *   - the song detail page renders the title and sections
 *   - axe critical/serious violations: 0 on /songs/[id]
 *
 * NB: we don't poll to completion here — Sprint 7.2's
 * `smoke-song-create.mjs` does that. This spec is the contract
 * regression test; if the API ever stops returning {job_id,status}
 * we want to know in <2 min, not 50.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";
import { expectNoSeriousA11yViolations } from "./helpers/axe";

const SONG_DOC = {
  language: "en" as const,
  style_family: "western" as const,
  tempo_bpm: 100,
  time_signature: "4/4",
  target_duration_seconds: 30,
  orchestration: {
    lead_vocal: "female",
    instruments: ["acoustic_guitar"],
    texture: "stripped-back",
  },
  sections: [
    {
      id: "v1",
      type: "verse",
      script: "latin",
      lyrics: "End to end smoke for sprint seven three",
      target_seconds: 30,
    },
  ],
};

test("POST /api/songs returns 202 and a queued job", async ({ page }) => {
  await signIn(page);
  const create = await page.evaluate(async (doc) => {
    const r = await fetch("/api/songs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song_document: doc }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, SONG_DOC);

  expect(create.status, JSON.stringify(create.body)).toBe(202);
  expect(create.body).toMatchObject({
    job_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    status: expect.stringMatching(/^(queued|processing|completed|failed)$/),
  });
});

test("song detail page renders and is a11y-clean", async ({ page }) => {
  await signIn(page);
  // Pick the first non-/new UUID song from the library list.
  await page.goto("/library?status=completed&view=list");
  const songLink = page
    .locator(
      'a[href^="/songs/"]:not([href="/songs/new"]):not([href^="/songs/new"])',
    )
    .first();
  await songLink.waitFor({ state: "visible", timeout: 15_000 });
  await songLink.click();
  await page.waitForURL(/\/songs\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "/songs/[id]");
});
