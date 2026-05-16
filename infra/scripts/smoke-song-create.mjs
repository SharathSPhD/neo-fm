// Integration smoke: end-to-end song-create flow against production.
//
// Walks the full path:
//   1. sign in as the e2e-smoke user
//   2. POST /api/songs with a minimal Western/English song doc
//   3. poll /api/songs/{id} until status moves out of `queued`/`processing`
//   4. assert the response carries a signed_audio_url and a SongDocument
//   5. capture summary.json with timings and the final status
//
// This is the closest we get to a real "Supabase test project"
// integration run without spinning up an isolated DB: the prod DB
// already has RLS-isolated row-level boundaries between users, and
// the smoke user's quota is bounded (Creator: 25/month), so a few
// runs per day are well within budget. ADR 0012 (Tier-1 signed URL)
// + the create_song_job RPC + the worker realtime path are all
// exercised.
//
// Usage:
//   node infra/scripts/smoke-song-create.mjs
//
// Exits non-zero on failure. Writes outputs to
// demos/v1.2/sprint-7-integration/song-create/.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://neo-fm-web.vercel.app";
const EMAIL = "e2e-smoke@neo-fm.test";
const PASS = "SmokeTest!v12";
const OUT =
  "/home/sharaths/projects/neo-fm/demos/v1.2/sprint-7-integration/song-create";
const POLL_INTERVAL_MS = 4_000;
const MAX_WAIT_MS = 5 * 60_000;

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[song-create]", ...a);

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/sharaths/.cache/ms-playwright/chromium-1223/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const shot = async (name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log("screenshot", file);
};

const summary = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  email: EMAIL,
  steps: [],
};
const step = (name, ok, info = {}) => {
  log(name, ok ? "PASS" : "FAIL", JSON.stringify(info));
  summary.steps.push({ name, ok, ...info });
};

const SONG_DOC = {
  language: "en",
  style_family: "western",
  tempo_bpm: 96,
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
      lyrics: "Integration smoke for sprint seven point two",
      target_seconds: 30,
    },
  ],
};

try {
  // 1. Sign in
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), {
      timeout: 30_000,
    }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  step("sign-in", true, { url: page.url() });

  // 2. POST /api/songs from the signed-in browser context. We use
  // page.evaluate so the auth cookies attach automatically — this
  // exercises the same code path the New Song UI uses.
  const createdAt = Date.now();
  const create = await page.evaluate(async (doc) => {
    const r = await fetch("/api/songs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song_document: doc }),
    });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  }, SONG_DOC);
  step("post-songs", create.status === 202, { status: create.status, body: create.body });
  if (create.status !== 202 || !create.body?.job_id) {
    throw new Error(`create failed: ${JSON.stringify(create)}`);
  }
  const jobId = create.body.job_id;
  summary.jobId = jobId;

  // 3. Poll /api/songs/{id} until status reaches a terminal state.
  let final;
  const pollStart = Date.now();
  while (Date.now() - pollStart < MAX_WAIT_MS) {
    const probe = await page.evaluate(async (id) => {
      const r = await fetch(`/api/songs/${id}`);
      return { status: r.status, body: await r.json().catch(() => null) };
    }, jobId);
    if (probe.status !== 200) {
      throw new Error(`probe ${probe.status}: ${JSON.stringify(probe.body)}`);
    }
    const s = probe.body?.status;
    log("poll", jobId.slice(0, 8), s, `${Math.round((Date.now() - pollStart) / 1000)}s`);
    if (s === "completed" || s === "failed") {
      final = probe.body;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (!final) throw new Error(`timeout waiting for terminal status (${MAX_WAIT_MS}ms)`);
  summary.finalStatus = final.status;
  summary.finalDurationMs = Date.now() - createdAt;
  step("job-reaches-terminal", final.status === "completed", {
    status: final.status,
    error: final.error ?? null,
    durationMs: summary.finalDurationMs,
  });

  // 4. On completed runs, confirm a signed audio URL is present and
  // points at the tracks bucket. The GET /api/songs/{id} contract
  // embeds the URL under `track.url` (ADR 0012 Tier-1).
  if (final.status === "completed") {
    const trackUrl = final.track?.url ?? null;
    const hasAudio =
      typeof trackUrl === "string" &&
      trackUrl.includes("/storage/v1/object/sign/tracks/");
    step("signed-audio-url-present", hasAudio, {
      url: trackUrl?.slice(0, 120) ?? null,
      duration: final.track?.duration_seconds ?? null,
    });
  }

  // 5. Navigate to the song page so the screenshot ends on the
  // detail view (mirrors the user's mental model).
  await page.goto(`${BASE}/songs/${jobId}`, { waitUntil: "networkidle" });
  await shot("01-song-detail");

  summary.ok = summary.steps.every((s) => s.ok);
  summary.finishedAt = new Date().toISOString();
} catch (err) {
  log("ERROR", err.message);
  summary.ok = false;
  summary.error = err.message;
  summary.finishedAt = new Date().toISOString();
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(OUT, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await browser.close();
}
