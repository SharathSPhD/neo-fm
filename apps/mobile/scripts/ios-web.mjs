// The iOS shell loads the live site in a WKWebView with the UA suffix `NeoFmApp/<ver> (ios)`. Playwright's WebKit is the same
// engine, so this checks the shell-only behaviour and the phone layouts on iPhone viewports without a Mac. Run by mobile-ios.yml.
import { webkit, devices } from "playwright-core";

const ORIGIN = process.env.NEO_FM_SHELL_URL ?? "https://www.neo-fm.com";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const browser = await webkit.launch();
for (const name of ["iPhone SE", "iPhone 13", "iPhone 15 Pro Max"]) {
  const d = devices[name];
  const ctx = await browser.newContext({ ...d, userAgent: `${d.userAgent} NeoFmApp/0.1.0 (ios)` });
  const page = await ctx.newPage();
  for (const path of ["/", "/station", "/pricing", "/sign-in"]) {
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
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
