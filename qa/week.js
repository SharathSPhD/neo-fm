// "Your week on neo-fm" on STAGING only (needs STATION_WEEK=1 there): signed-out is sent to sign-in, signed-in gets the page, the API and the share card.
// Env: QA_STAGING_URL, QA_STAGING_EMAIL, QA_STAGING_PASSWORD. Refuses prod hosts.
const { chromium } = require('playwright-core');
const { chromiumPath } = require('./common');

const base = (process.env.QA_STAGING_URL || 'https://neo-fm-staging.vercel.app').replace(/\/$/, '');
const email = process.env.QA_STAGING_EMAIL;
const pw = process.env.QA_STAGING_PASSWORD;
if (!email || !pw || /(^|\/\/)(www\.)?neo-fm\.com|neo-fm-web\.vercel\.app/.test(base)) {
  console.error('refusing: need a staging URL (never prod) and QA_STAGING_EMAIL / QA_STAGING_PASSWORD');
  process.exit(2);
}

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  let bad = 0;
  const check = (ok, msg) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', msg); };

  const anon = await (await b.newContext()).newPage();
  const r0 = await anon.goto(base + '/station/week', { waitUntil: 'load', timeout: 60000 });
  check(r0.status() === 200 && /sign-in/.test(new URL(anon.url()).pathname), `signed-out /station/week goes to sign-in (${r0.status()} ${new URL(anon.url()).pathname})`);
  const api0 = await anon.evaluate(async () => (await fetch('/api/station/week')).status);
  check(api0 === 401, `signed-out /api/station/week is 401 (${api0})`);

  for (const [name, vp] of [['desk', { width: 1280, height: 800 }], ['m390', { width: 390, height: 844 }]]) {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));
    for (let a = 0; a < 2; a++) { try { await p.goto(base + '/sign-in', { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (a) throw e; } }
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', pw);
    await Promise.all([p.waitForURL((u) => !/sign-in/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
    if (/sign-in/.test(new URL(p.url()).pathname)) { check(false, `${name} sign-in`); continue; }
    const r = await p.goto(base + '/station/week', { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(1500);
    const h = await p.evaluate(() => (document.querySelector('h1,h2') || {}).innerText || '');
    check(r.status() === 200 && !!h, `${name} week page opens: "${h.slice(0, 40)}"`);
    const api = await p.evaluate(async () => { const x = await fetch('/api/station/week'); let j = {}; try { j = await x.json(); } catch {} return { s: x.status, k: Object.keys(j) }; });
    check(api.s === 200 && api.k.includes('week'), `${name} /api/station/week 200 with a week (${api.s} ${api.k})`);
    const img = await p.evaluate(async () => { const x = await fetch('/api/station/week/image'); return { s: x.status, t: x.headers.get('content-type') || '' }; });
    if (img.s === 200 && /^image\//.test(img.t)) console.log(`ok   ${name} share card is an image (${img.t})`);
    else console.log(`info ${name} share card gave ${img.s} ${img.t} (an empty week may have no card)`);
    check(errs.length === 0, `${name} no page errors ${errs.join(' | ')}`);
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('week check failed', e.message.split('\n')[0]); process.exit(1); });
