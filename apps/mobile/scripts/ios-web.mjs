// The iOS shell loads the live site in a WKWebView with the UA suffix `NeoFmApp/<ver> (ios)`. Playwright's WebKit is the same
// engine, so this checks the shell-only behaviour and the phone layouts on iPhone viewports without a Mac. Run by mobile-ios.yml.
import { webkit, devices } from "playwright-core";

const ORIGIN = process.env.NEO_FM_SHELL_URL ?? "https://www.neo-fm.com";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const sitemap = await (await fetch(ORIGIN + "/sitemap.xml")).text();
const trackPath = sitemap.match(/\/t\/[0-9a-f-]{36}/i)?.[0];
check("sitemap lists a public track for the listen-together check", !!trackPath, String(trackPath));
const browser = await webkit.launch();
if (trackPath) {
  // WebKit's first audio playback on a fresh runner stalls for minutes (iPhone SE, first in line, read currentTime 0
  // after a 6 minute stall in every run, loading metadata alone did not help); play a second of it once so the per-device checks measure the page, not the runner.
  const warm = await (await browser.newContext()).newPage();
  const t0 = Date.now();
  await warm.goto(ORIGIN + trackPath, { waitUntil: "networkidle" });
  await warm.evaluate(() => new Promise((res) => { const a = document.querySelector("audio"); if (!a) return res(); a.muted = true; a.addEventListener("timeupdate", () => { if (a.currentTime > 1) res(); }); a.addEventListener("error", res, { once: true }); a.play().catch(res); setTimeout(res, 600000); })).catch(() => {});
  console.log(`audio warm-up took ${Math.round((Date.now() - t0) / 1000)}s`);
  await warm.context().close();
}
for (const name of ["iPhone SE", "iPhone 13", "iPhone 15 Pro Max"]) {
  const d = devices[name];
  const ctx = await browser.newContext({ ...d, userAgent: `${d.userAgent} NeoFmApp/0.1.0 (ios)` });
  const page = await ctx.newPage();
  for (const path of ["/", "/discover", "/templates", "/pricing", "/help", "/whats-new", "/trust", "/ideas", "/feedback", "/privacy", "/terms", "/ai-disclosure", "/grievance", "/refusals", "/sign-in", "/station"]) {
    await page.goto(ORIGIN + path, { waitUntil: "networkidle" });
    const m = await page.evaluate(() => {
      const w = innerWidth;
      const bad = [...document.querySelectorAll("a,button,input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.right > w + 1 || r.left < -1); }).map((e) => (e.innerText || e.tagName).trim().slice(0, 30));
      return { w, scrollW: document.scrollingElement.scrollWidth, bad };
    });
    check(`${name} ${path}: nothing past the screen edge`, m.scrollW <= m.w + 1 && m.bad.length === 0, JSON.stringify(m));
    if (path === "/pricing") {
      const buy = await page.evaluate(() => [...document.querySelectorAll("button")].map((e) => e.innerText.trim()).filter((t) => /^(upgrade|buy|subscribe|get creator|get pro)/i.test(t)).length);
      check(`${name}: no purchase buttons on /pricing`, buy === 0, `found ${buy}`);
      const st = await page.evaluate(() => fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status));
      check(`${name}: checkout refused for the app (403)`, st === 403, `status ${st}`);
    }
    if (path === "/sign-in") check(`${name}: no Google sign-in in the app`, !/continue with google/i.test(await page.evaluate(() => document.body.innerText)));
  }
  if (trackPath) {
    // listen together: a station share link carries the sender's playhead (at, seconds) and send time (ts, epoch ms)
    await page.goto(`${ORIGIN}${trackPath}?at=20&ts=${Date.now() - 5000}`, { waitUntil: "networkidle" });
    const banner = page.getByText(/a friend is listening to this right now/i);
    await banner.waitFor({ timeout: 10000 }).catch(() => {});
    check(`${name}: together banner shows on a fresh share link`, await banner.isVisible());
    const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1);
    check(`${name}: together banner fits the screen`, fits);
    await page.getByRole("button", { name: /listen together/i }).click({ timeout: 15000 }).catch(() => {});
    let seeked = -1;
    for (let i = 0; i < 20 && seeked < 24; i++) {
      await page.waitForTimeout(1000);
      seeked = await page.evaluate(() => { const a = document.querySelector("audio"); return a ? a.currentTime : -1; });
    }
    check(`${name}: joining seeks to about the sender's playhead`, seeked >= 24 && seeked < 60, `currentTime ${seeked}`);
    await page.goto(`${ORIGIN}${trackPath}?at=20&ts=${Date.now() - 3 * 3600_000}`, { waitUntil: "networkidle" });
    check(`${name}: a stale share link is a plain player`, !(await page.getByText(/a friend is listening/i).isVisible()));
  }
  await ctx.close();
  // landscape
  const lctx = await browser.newContext({ ...d, userAgent: `${d.userAgent} NeoFmApp/0.1.0 (ios)`, viewport: { width: d.viewport.height, height: d.viewport.width } });
  const lpage = await lctx.newPage();
  for (const path of ["/", "/station", "/pricing"]) {
    await lpage.goto(ORIGIN + path, { waitUntil: "networkidle" });
    const m = await lpage.evaluate(() => ({ w: innerWidth, scrollW: document.scrollingElement.scrollWidth }));
    check(`${name} landscape ${path}: no sideways scroll`, m.scrollW <= m.w + 1, JSON.stringify(m));
  }
  await lctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
