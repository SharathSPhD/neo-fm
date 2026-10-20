// Stripe test-mode checkout per plan on STAGING only. Opens Checkout Sessions but never completes them.
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
// Creator and Pro must give a Stripe Checkout URL. Optional ones may be unconfigured (price id not set).
const plans = [
  ['creator monthly', { tier: 'creator', interval: 'month' }, true],
  ['pro monthly', { tier: 'pro', interval: 'month' }, true],
  ['station pass', { pass: 'station' }, false],
  ['creator annual', { tier: 'creator', interval: 'year' }, false],
  ['pro annual', { tier: 'pro', interval: 'year' }, false],
  ['gift pack single', { pack: 'single' }, false],
  ['gift pack three', { pack: 'three' }, false],
];

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  const p = await (await b.newContext()).newPage();
  for (let a = 0; a < 2; a++) { try { await p.goto(base + '/sign-in', { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (a) throw e; } }
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL((u) => !/sign-in/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
  if (/sign-in/.test(new URL(p.url()).pathname)) { console.log('FAIL sign-in'); process.exit(1); }
  await p.goto(base + '/pricing', { waitUntil: 'load', timeout: 60000 });
  let bad = 0;
  for (const [name, body, required] of plans) {
    const r = await p.evaluate(async (bd) => {
      const res = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bd) });
      let j = {}; try { j = await res.json(); } catch {}
      return { status: res.status, url: j.url || '', error: j.error || '', details: (j.details || '').toString().slice(0, 160), manage: !!j.manage_url };
    }, body);
    const good = r.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(r.url);
    const note = r.manage ? 'already subscribed (manage link)' : [r.error, r.details].filter(Boolean).join(' ');
    if (good) console.log('ok  ', name, 'stripe checkout url');
    else if (r.manage) console.log('ok  ', name, note);
    else if (required) { bad++; console.log('FAIL', name, r.status, note); }
    else console.log('info', name, r.status, note || '(not configured)');
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('checkout failed', e.message.split('\n')[0]); process.exit(1); });
