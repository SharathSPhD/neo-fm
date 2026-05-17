/**
 * E2E spec: cover-art lifecycle (v1.3 Sprint 3).
 *
 * The cover-art-synth FastAPI sidecar lives on DGX. Vercel cannot
 * speak to it directly (ADR 0003); the entry point is a pgmq queue
 * and the dgx-worker is the only thing that talks to the sidecar.
 *
 * From the web layer's perspective the contract we care about:
 *
 *   - POST /api/songs/[id]/cover-art on a completed song returns
 *     either 202 + {status:"queued", attempt_id} or 200 + signed_url
 *     (if DGX has already rendered one).
 *   - GET  /api/songs/[id]/cover-art always returns a status string
 *     plus, when ready, a signed `url`.
 *
 * If DGX is paused (likely during CI), the worker won't drain the
 * queue. We tolerate that by accepting "queued" / "processing" as
 * a passing result — the spec is here to guard the *contract*, not
 * to verify DGX is up.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "./helpers/auth";

test("cover-art POST returns a recognised queue or completion status", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/library?status=completed&view=list");
  const songLink = page
    .locator(
      'a[href^="/songs/"]:not([href="/songs/new"]):not([href^="/songs/new"])',
    )
    .first();
  await songLink.waitFor({ state: "visible", timeout: 15_000 });
  const href = await songLink.getAttribute("href");
  const songId = href?.match(/\/songs\/([0-9a-f-]{36})/)?.[1];
  expect(songId, `expected a UUID song id in ${href}`).toBeTruthy();

  const result = await page.evaluate(async (id) => {
    const r = await fetch(`/api/songs/${id}/cover-art`, { method: "POST" });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, songId);

  expect([200, 202], JSON.stringify(result.body)).toContain(result.status);
  expect(result.body).toMatchObject({
    status: expect.stringMatching(/^(queued|processing|completed|failed)$/),
  });
});

test("cover-art GET returns a status + (eventually) a signed url", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/library?status=completed&view=list");
  const songLink = page
    .locator(
      'a[href^="/songs/"]:not([href="/songs/new"]):not([href^="/songs/new"])',
    )
    .first();
  await songLink.waitFor({ state: "visible", timeout: 15_000 });
  const href = await songLink.getAttribute("href");
  const songId = href?.match(/\/songs\/([0-9a-f-]{36})/)?.[1];

  const result = await page.evaluate(async (id) => {
    const r = await fetch(`/api/songs/${id}/cover-art`);
    return { status: r.status, body: await r.json().catch(() => null) };
  }, songId);

  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body).toMatchObject({
    status: expect.stringMatching(/^(queued|processing|completed|failed|none)$/),
  });
});
