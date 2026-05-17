// Full production smoke (Sprint 8). Drives a real Chromium against
// neo-fm-web.vercel.app, captures a screenshot at every major surface,
// and writes a SUMMARY.md with the result of each check.
//
// Surfaces exercised:
//   1. anonymous landing
//   2. /pricing (anon)
//   3. /discover (anon)
//   4. /sign-in form
//   5. signed-in /library (grid)
//   6. /library (list view via toggle)
//   7. Cmd-K command palette
//   8. /songs/new
//   9. /pricing (authed)
//  10. /account
//  11. a completed song detail (incl. Make a remix CTA)
//
// We don't actually fork a remix here — that's covered by the
// dedicated Playwright spec and the Sprint 6.3 demo bundle.

// `@playwright/test`'s public ESM entry doesn't re-export `chromium`
// (it only exposes the test runner API). We need the lower-level
// `playwright` package that's installed alongside it under pnpm's
// isolated tree. Resolve its path explicitly from the @playwright/test
// install location so this works regardless of where node is launched.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
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
import fs from "node:fs";

const BASE = process.env.SMOKE_BASE ?? "https://neo-fm-web.vercel.app";
const OUT =
  process.env.SMOKE_OUT ?? "/home/sharaths/projects/neo-fm/demos/v1.3/sprint-6-prod-smoke";
const EMAIL = process.env.SMOKE_EMAIL ?? "e2e-smoke@neo-fm.test";
const PASS = process.env.SMOKE_PASS ?? "SmokeTest!v12";

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[smoke8]", ...a);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/sharaths/.cache/ms-playwright/chromium-1223/chrome-linux/chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  // Bypass the library-onboarding modal so we don't have to dismiss
  // it before each screenshot.
  storageState: undefined,
});
await ctx.addInitScript(() => {
  try {
    window.localStorage.setItem("neo-fm:library-onboarded", "1");
  } catch {
    // private-mode browsers — modal will appear and require a
    // dismiss; tolerate that.
  }
});
const page = await ctx.newPage();

const steps = [];
const shot = async (name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log("shot", file);
  return file;
};
const step = async (name, fn) => {
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ...detail });
    log(name, "PASS", JSON.stringify(detail ?? {}));
  } catch (err) {
    steps.push({ name, ok: false, error: err.message });
    log(name, "FAIL", err.message);
    await shot(`fail-${name}`).catch(() => {});
  }
};

try {
  await step("1-landing", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    const file = await shot("01-landing");
    // v1.3 wedge gate: the production landing must lead with the
    // phoneme promise. If the H1 ever loses the word "phoneme" we
    // want the smoke to go red, not silently roll back the wedge.
    const h1 = (await page.locator("h1").first().textContent()) ?? "";
    if (!/phoneme/i.test(h1)) {
      throw new Error(
        `landing H1 missing wedge keyword "phoneme": ${JSON.stringify(h1)}`,
      );
    }
    if (!/Indian languages/i.test(h1)) {
      throw new Error(
        `landing H1 missing "Indian languages": ${JSON.stringify(h1)}`,
      );
    }
    return { url: page.url(), file: path.basename(file), h1 };
  });

  await step("2-pricing-anon", async () => {
    await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
    const file = await shot("02-pricing-anon");
    return { url: page.url(), file: path.basename(file) };
  });

  await step("3-discover-anon", async () => {
    await page.goto(`${BASE}/discover`, { waitUntil: "networkidle" });
    const file = await shot("03-discover-anon");
    return { url: page.url(), file: path.basename(file) };
  });

  await step("4-sign-in", async () => {
    await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
    await shot("04-sign-in-form");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASS);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), {
        timeout: 30_000,
      }),
      page.getByRole("button", { name: /sign in/i }).click(),
    ]);
    return { url: page.url() };
  });

  await step("5-library-grid", async () => {
    if (!page.url().includes("/library")) {
      await page.goto(`${BASE}/library`, { waitUntil: "networkidle" });
    }
    const file = await shot("05-library-grid");
    return { url: page.url(), file: path.basename(file) };
  });

  await step("6-library-list", async () => {
    // The View-mode toggle uses "▦ Grid" / "☰ List" as visible
    // labels; getByRole("button", { name: /list/i }) matches the
    // accessible name "☰ List".
    const listBtn = page.getByRole("button", { name: /list/i }).first();
    await listBtn.click();
    await page.waitForFunction(
      () => window.location.search.includes("view=list"),
      null,
      { timeout: 10_000 },
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    const file = await shot("06-library-list");
    return { url: page.url(), file: path.basename(file) };
  });

  await step("7-cmd-palette", async () => {
    await page.keyboard.press("Control+K");
    await page.locator("[cmdk-root]").first().waitFor({ state: "visible" });
    const file = await shot("07-cmd-palette");
    await page.keyboard.press("Escape");
    return { file: path.basename(file) };
  });

  await step("8-songs-new", async () => {
    await page.goto(`${BASE}/songs/new`, { waitUntil: "networkidle" });
    const file = await shot("08-songs-new");
    // v1.3 Sprint 2 split bhavageete out of folk and added Tamil
    // folk + Kannada light-classical. Assert every preset chip is
    // actually painted — silent-drop is what tagore-set was doing
    // for months before v1.3.
    const requiredPresets = [
      "carnatic-kriti",
      "hindustani-khayal-sketch",
      "kannada-bhavageete",
      "kannada-folk",
      "tamil-folk",
      "bollywood-ballad",
      "western-pop",
      "kabir-doha",
    ];
    // The creation canvas exposes presets as <button data-preset>
    // chips (it doesn't navigate -- it mutates form state). The
    // marketing landing exposes them as <a href="/songs/new?preset=">.
    // Both are valid signals that a preset is wired up; check both so
    // the smoke survives either UI.
    const seen = await page.evaluate(() => {
      const ids = new Set();
      for (const el of document.querySelectorAll("[data-preset]")) {
        const id = el.getAttribute("data-preset");
        if (id) ids.add(id);
      }
      for (const a of document.querySelectorAll("a[href*='preset=']")) {
        const u = new URL(a.getAttribute("href") || "", location.origin);
        const id = u.searchParams.get("preset");
        if (id) ids.add(id);
      }
      return Array.from(ids);
    });
    const missing = requiredPresets.filter((p) => !seen.includes(p));
    if (missing.length > 0) {
      throw new Error(
        `presets missing from /songs/new: ${JSON.stringify(missing)}`,
      );
    }
    return {
      url: page.url(),
      file: path.basename(file),
      presetsFound: seen.length,
    };
  });

  await step("9-pricing-authed", async () => {
    await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
    const file = await shot("09-pricing-authed");
    return { url: page.url(), file: path.basename(file) };
  });

  await step("10-account", async () => {
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    const file = await shot("10-account");
    return { url: page.url(), file: path.basename(file) };
  });

  await step("11-song-detail", async () => {
    await page.goto(`${BASE}/library?status=completed&view=list`, {
      waitUntil: "networkidle",
    });
    const songLink = page
      .locator(
        'a[href^="/songs/"]:not([href="/songs/new"]):not([href^="/songs/new"])',
      )
      .first();
    await songLink.waitFor({ state: "visible", timeout: 15_000 });
    await songLink.click();
    await page.waitForURL(/\/songs\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    // The Make-a-remix CTA is gated on `data.status === "completed"`
    // (see apps/web/app/(app)/songs/[id]/page.tsx). The library is
    // filtered to completed songs, so the button should always
    // appear for the smoke user. Wait up to 10s for it before
    // recording its presence.
    const remixBtn = page
      .getByRole("button", { name: /make a remix/i })
      .first();
    const remixVisible = await remixBtn
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const file = await shot("11-song-detail");
    return {
      url: page.url(),
      file: path.basename(file),
      remixCtaVisible: remixVisible,
    };
  });

  await step("12-cover-art-panel", async () => {
    // We're already on a completed song detail from the previous
    // step; capture the cover-art panel so v1.3 Sprint 3's
    // DGX-rendered cover-art lifecycle is recorded against
    // production. The panel polls GET /api/songs/[id]/cover-art so
    // a stuck "Cover art generating…" copy is the failure mode
    // we'd most want to spot.
    const panel = page
      .locator('[data-testid="cover-art-panel"], section:has(h2:text-matches("cover art", "i"))')
      .first();
    const visible = await panel
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    const file = await shot("12-cover-art-panel");
    return { file: path.basename(file), panelVisible: visible };
  });

  await step("health-anon", async () => {
    // v1.3 Sprint 1 privacy gate: anon /api/health must NOT leak
    // a commit SHA. We re-issue the probe from a brand-new
    // browser context so the auth cookies from step 4 don't
    // leak into the request.
    const anonCtx = await browser.newContext({ viewport: { width: 1, height: 1 } });
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(BASE, { waitUntil: "domcontentloaded" });
    const probe = await anonPage.evaluate(async () => {
      const r = await fetch("/api/health");
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    await anonCtx.close();
    if (probe.status !== 200) {
      throw new Error(`health ${probe.status}: ${JSON.stringify(probe.body)}`);
    }
    const body = probe.body ?? {};
    const looksLikeSha = (s) =>
      typeof s === "string" && /^[0-9a-f]{7,40}$/.test(s);
    if (looksLikeSha(body.commit) || looksLikeSha(body.version)) {
      throw new Error(
        `anon /api/health leaked commit SHA: ${JSON.stringify(body)}`,
      );
    }
    return probe;
  });

  await step("health", async () => {
    const probe = await page.evaluate(async () => {
      const r = await fetch("/api/health");
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    if (probe.status !== 200) {
      throw new Error(`health ${probe.status}: ${JSON.stringify(probe.body)}`);
    }
    return probe;
  });
} catch (err) {
  log("ERROR", err.stack ?? err.message);
} finally {
  const allOk = steps.every((s) => s.ok);
  const lines = [
    "# v1.3 Sprint 6 — production smoke",
    "",
    `**Target**: ${BASE}`,
    `**Smoke user**: ${EMAIL}`,
    `**Date**: ${new Date().toISOString()}`,
    `**Overall**: ${allOk ? "GREEN — every surface rendered as expected" : "RED — see failed step below"}`,
    "",
    "| # | Step | Result | Notes |",
    "| --- | --- | --- | --- |",
  ];
  for (const [i, s] of steps.entries()) {
    const notes = s.ok
      ? Object.entries(s)
          .filter(([k]) => !["name", "ok"].includes(k))
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ")
      : s.error;
    lines.push(
      `| ${i + 1} | \`${s.name}\` | ${s.ok ? "✅" : "❌"} | ${notes ?? ""} |`,
    );
  }
  lines.push("");
  lines.push("## Screenshots");
  lines.push("");
  for (const s of steps) {
    if (s.file) lines.push(`- ![${s.name}](./${s.file})`);
  }
  lines.push("");
  fs.writeFileSync(path.join(OUT, "SUMMARY.md"), lines.join("\n"));
  fs.writeFileSync(
    path.join(OUT, "summary.json"),
    JSON.stringify({ base: BASE, finishedAt: new Date().toISOString(), steps }, null, 2),
  );
  await browser.close();
  process.exitCode = allOk ? 0 : 1;
}
