// Signed-in pass against STAGING only. Env: QA_STAGING_URL, QA_STAGING_EMAIL, QA_STAGING_PASSWORD.
// Refuses prod hosts. Login can take 6-20 s on staging, so the post-login wait is 30 s.
// Expected failures on staging until its service-role key is set: /collections, /api/station/queue, /api/events.
const { chromium } = require('playwright-core');
const { chromiumPath } = require('./common');

const base = (process.env.QA_STAGING_URL || 'https://neo-fm-staging.vercel.app').replace(/\/$/, '');
const email = process.env.QA_STAGING_EMAIL;
const pw = process.env.QA_STAGING_PASSWORD;
if (!email || !pw || /(^|\/\/)(www\.)?neo-fm\.com|neo-fm-web\.vercel\.app/.test(base)) {
  console.error('refusing: need a staging URL (never prod) and QA_STAGING_EMAIL / QA_STAGING_PASSWORD');
  process.exit(2);
}
const EXPECTED = /\/collections|\/api\/station\/queue|\/api\/events/;
const routes = ['/station', '/library', '/songs/new', '/account', '/pricing', '/gift', '/discover'];

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  let problems = 0;
  for (const [n, o] of [['desk', { viewport: { width: 1280, height: 800 } }], ['m390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    const c = await b.newContext(o);
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 80)));
    p.on('response', (r) => { if (r.status() >= 500 && !EXPECTED.test(r.url())) errs.push(`${r.status()} ${r.url().replace(base, '').slice(0, 60)}`); });
    // Staging cold starts can exceed 30 s; retry the first navigation once.
    for (let a = 0; a < 2; a++) { try { await p.goto(base + '/sign-in', { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (a) throw e; } }
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', pw);
    await Promise.all([p.waitForURL((u) => !/sign-in/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
    const ok = !/sign-in/.test(new URL(p.url()).pathname);
    console.log(n, 'signed in:', ok);
    if (!ok) { problems++; await c.close(); continue; }
    for (const r of routes) {
      const res = await p.goto(base + r, { waitUntil: 'load', timeout: 60000 });
      await p.waitForTimeout(800);
      const i = await p.evaluate(() => ({ h1: (document.querySelector('h1') || {}).innerText?.slice(0, 40), ovf: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, signedOut: /sign-in/.test(location.pathname) }));
      const flagged = res.status() >= 400 || i.ovf || i.signedOut || errs.length;
      if (flagged) problems++;
      console.log(flagged ? 'FLAG' : 'ok  ', n, r, res.status(), JSON.stringify(i), errs.length ? errs.splice(0) : '');
    }
    await c.close();
  }
  await b.close();
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error('staging pass failed:', e.message.split('\n')[0]); process.exit(1); });
