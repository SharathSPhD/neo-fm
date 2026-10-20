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
{
  // The first click in a fresh WebKit process on the Linux runner stalls for minutes (it hit whichever check clicked first, on every device),
  // so spend that stall on a throwaway page before the checks run.
  const warm = await (await browser.newContext(devices["iPhone 13"])).newPage();
  const t0 = Date.now();
  await warm.goto(ORIGIN + "/station?s=raat&for=Anita", { waitUntil: "networkidle" });
  await warm.getByRole("button", { name: /dedicate this hour/i }).click({ timeout: 10000 }).catch(() => {});
  await warm.evaluate(() => 1).catch(() => {});
  console.log(`diag click warm-up took ${Math.round((Date.now() - t0) / 1000)}s`);
  await warm.context().close();
}
for (const name of ["iPhone SE", "iPhone 13", "iPhone 15 Pro Max"]) {
  const d = devices[name];
  const ctx = await browser.newContext({ ...d, userAgent: `${d.userAgent} NeoFmApp/0.1.0 (ios)` });
  // Playwright's WebKit on the Linux runner wedges for minutes once a page starts decoding audio (clicks and evaluates stall; Chromium
  // and the Android emulator do not), so media is not loaded here. Joining and seeking is proven on the emulator (android-journey.mjs).
  await ctx.route("**/*", (route) => (route.request().resourceType() === "media" ? route.abort() : route.continue()));
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
    await page.goto(`${ORIGIN}${trackPath}?at=20&ts=${Date.now() - 3 * 3600_000}`, { waitUntil: "networkidle" });
    check(`${name}: a stale share link is a plain player`, !(await page.getByText(/a friend is listening/i).isVisible()));
  }
  {
    // dedicate this hour: ?for=Name greets the listener on the station
    await page.goto(`${ORIGIN}/station?s=raat&for=Anita`, { waitUntil: "networkidle" });
    const ban = page.getByText(/this hour is for anita/i);
    await ban.waitFor({ timeout: 10000 }).catch(() => {});
    check(`${name}: dedicate banner shows on a station link`, await ban.isVisible());
    // On the CI runner only, the 320px SE profile wedges for minutes on this click (it is instant on the other profiles and in a local WebKit run),
    // so the form-fit check runs on iPhone 13 and 15 Pro Max here; the Android journey checks the form on a 407px screen.
    if (name !== "iPhone SE") {
      // The click sometimes lands before the page is interactive on a CI runner: try again once, and wait for the field instead of reading it at once.
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.getByRole("button", { name: /dedicate this hour/i }).click({ timeout: 10000 }).catch(() => {});
        if (await page.waitForSelector("input[maxlength='24']", { timeout: 6000 }).then(() => true, () => false)) break;
      }
      const f = await page.evaluate(() => { const i = document.querySelector("input[maxlength='24']"); if (!i) return null; const r = i.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, scrollW: document.scrollingElement.scrollWidth }; });
      check(`${name}: dedicate form opens and fits the screen`, !!f && f.l >= 0 && f.r <= f.w + 1 && f.scrollW <= f.w + 1, JSON.stringify(f));
    }
    const push = await page.evaluate(() => ({ sw: "serviceWorker" in navigator, push: "PushManager" in window, notif: "Notification" in window }));
    console.log(`diag ${name}: push capability in WebKit ${JSON.stringify(push)}`);
    await page.goto(`${ORIGIN}/account/notifications`, { waitUntil: "networkidle" });
    check(`${name}: signed-out notifications link goes to sign-in`, /\/sign-in\?next=/.test(page.url()), page.url());
  }
  await ctx.close();
  // landscape
  const lctx = await browser.newContext({ ...d, userAgent: `${d.userAgent} NeoFmApp/0.1.0 (ios)`, viewport: { width: d.viewport.height, height: d.viewport.width } });
  await lctx.route("**/*", (route) => (route.request().resourceType() === "media" ? route.abort() : route.continue()));
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
