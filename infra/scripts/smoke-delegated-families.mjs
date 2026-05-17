// v1.4 live-bug closeout — POST a minimal song-doc for each of the
// four delegated style families against prod and confirm the queue
// accepts 202 (was 400 `co_composer_rejected` pre-fix).
//
// Usage:
//   node infra/scripts/smoke-delegated-families.mjs
//
// Exits non-zero if any family returns non-202 OR if the error body
// mentions `co_composer_rejected`.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const requireFromWeb = createRequire(
  pathToFileURL("/home/sharaths/projects/neo-fm/apps/web/package.json"),
);
const pwtPkg = requireFromWeb.resolve("@playwright/test/package.json");
const playwrightEntry = path.join(
  path.dirname(pwtPkg),
  "..",
  "..",
  "playwright",
  "index.mjs",
);
const { chromium } = await import(pathToFileURL(playwrightEntry).href);

const BASE = process.env.SMOKE_BASE ?? "https://neo-fm-web.vercel.app";
const EMAIL = process.env.SMOKE_EMAIL ?? "e2e-smoke@neo-fm.test";
const PASS = process.env.SMOKE_PASS ?? "SmokeTest!v12";
const OUT =
  process.env.SMOKE_OUT ??
  "/home/sharaths/projects/neo-fm/demos/v1.4/live-bug-closeout";

fs.mkdirSync(OUT, { recursive: true });

const FAMILY_DOCS = {
  "sanskrit-shloka": {
    language: "sa",
    style_family: "sanskrit-shloka",
    target_duration_seconds: 30,
    sections: [
      {
        id: "v1",
        type: "verse",
        script: "devanagari",
        lyrics: "ॐ नमः शिवाय",
        target_seconds: 30,
      },
    ],
  },
  "telugu-keerthana": {
    language: "te",
    style_family: "telugu-keerthana",
    target_duration_seconds: 30,
    sections: [
      {
        id: "p1",
        type: "pallavi",
        script: "telugu",
        lyrics: "శ్రీ గణేశాయ నమః",
        target_seconds: 30,
      },
    ],
  },
  "bengali-rabindrasangeet": {
    language: "bn",
    style_family: "bengali-rabindrasangeet",
    target_duration_seconds: 30,
    sections: [
      {
        id: "m1",
        type: "mukhda",
        script: "bengali",
        lyrics: "আমার সোনার বাংলা",
        target_seconds: 30,
      },
    ],
  },
  "bollywood-ballad": {
    language: "hi",
    style_family: "bollywood-ballad",
    target_duration_seconds: 30,
    tempo_bpm: 75,
    sections: [
      {
        id: "m1",
        type: "mukhda",
        script: "devanagari",
        lyrics: "तेरे बिना ज़िंदगी",
        target_seconds: 30,
      },
    ],
  },
};

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/sharaths/.cache/ms-playwright/chromium-1223/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const summary = {
  startedAt: new Date().toISOString(),
  base: BASE,
  results: {},
};

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), {
      timeout: 30_000,
    }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);

  let allOk = true;
  for (const [family, doc] of Object.entries(FAMILY_DOCS)) {
    const probe = await page.evaluate(async (d) => {
      const r = await fetch("/api/songs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ song_document: d }),
      });
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    }, doc);
    const ok =
      probe.status === 202 &&
      !JSON.stringify(probe.body ?? {}).includes("co_composer_rejected");
    summary.results[family] = {
      ok,
      status: probe.status,
      job_id: probe.body?.job_id ?? null,
      error: probe.body?.error ?? null,
    };
    if (!ok) allOk = false;
    console.log(
      `[delegated] ${family}: ${ok ? "PASS" : "FAIL"} status=${probe.status} ${JSON.stringify(probe.body).slice(0, 160)}`,
    );
  }
  summary.ok = allOk;
  summary.finishedAt = new Date().toISOString();
} catch (err) {
  summary.ok = false;
  summary.error = err.message;
  summary.finishedAt = new Date().toISOString();
  console.error("[delegated] ERROR", err.stack ?? err.message);
} finally {
  fs.writeFileSync(
    path.join(OUT, "delegated-families.json"),
    JSON.stringify(summary, null, 2),
  );
  await browser.close();
  process.exitCode = summary.ok ? 0 : 1;
}
