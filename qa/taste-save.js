// Saved taste profile (migration 0113) on STAGING only: fresh throwaway user, no-consent Save note, then consent, Save, reload with the
// browser copy cleared (so the prefill must come from the server), Forget. Env: QA_STAGING_URL. Never prints credentials. Refuses prod hosts.
const { chromium } = require('playwright-core');
const { chromiumPath } = require('./common');

const base = (process.env.QA_STAGING_URL || 'https://neo-fm-staging.vercel.app').replace(/\/$/, '');
if (/(^|\/\/)(www\.)?neo-fm\.com|neo-fm-web\.vercel\.app/.test(base)) { console.error('refusing: staging only'); process.exit(2); }

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  let bad = 0;
  const check = (ok, msg) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', msg); };
  const rnd = Math.random().toString(36).slice(2, 10);
  await p.goto(base + '/sign-up', { waitUntil: 'load', timeout: 60000 });
  await p.fill('input[name=email]', `qa-save-${rnd}@neo-fm.test`);
  await p.fill('input[name=password]', `Qa-${rnd}-${Math.random().toString(36).slice(2, 10)}`);
  await Promise.all([p.waitForURL((u) => !/sign-up/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
  if (/sign-up/.test(new URL(p.url()).pathname)) { console.log('FAIL fresh sign-up did not sign in'); process.exit(1); }

  const open = async () => {
    await p.goto(base + '/songs/new', { waitUntil: 'load', timeout: 60000 });
    await p.waitForSelector('#prompt-language', { timeout: 20000 });
    await p.locator('details > summary', { hasText: /taste/i }).first().click();
  };
  const pressed = () => p.$$eval('fieldset button[aria-pressed=true]', (x) => x.map((e) => e.textContent.trim()));
  const api = (method, body) => p.evaluate(async ([m, bd]) => { const r = await fetch('/api/me/taste/stated', { method: m, headers: { 'content-type': 'application/json' }, body: bd ? JSON.stringify(bd) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [method, body]);

  await open();
  const saveBtn = p.getByRole('button', { name: /Save to my profile/i });
  check(await saveBtn.count() > 0, 'Save and Forget buttons are shown (0113 is applied on staging)');
  for (const t of ['pop', 'piano', 'calm']) { const c = p.locator('fieldset button', { hasText: new RegExp(`^${t}$`) }).first(); if (await c.count()) await c.click(); }

  // Case 2: no consent yet.
  await saveBtn.click();
  await p.waitForTimeout(1500);
  const note1 = (await p.locator('[role=status]').allTextContents()).join(' ');
  check(/personalization/i.test(note1), `Save without consent shows the consent-needed note (${note1.trim().slice(0, 70)})`);

  // Case 1: grant consent via the app's own endpoint, then Save.
  const consent = await p.evaluate(async () => (await fetch('/api/me/taste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true }) })).status);
  check(consent === 200, `personalize consent granted (${consent})`);
  await saveBtn.click();
  await p.waitForTimeout(1500);
  const note2 = (await p.locator('[role=status]').allTextContents()).join(' ');
  check(/Saved/i.test(note2), `Save with consent shows Saved (${note2.trim().slice(0, 70)})`);
  const got = await api('GET');
  check(got.status === 200 && (got.j.taste?.genres || []).includes('pop'), `server holds the saved profile (${got.status} ${JSON.stringify(got.j).slice(0, 100)})`);

  // Reload with the browser copy cleared: prefill must come from the server.
  await p.evaluate(() => window.localStorage.clear());
  await open();
  await p.waitForTimeout(1500);
  const after = await pressed();
  check(['pop', 'piano', 'calm'].every((w) => after.some((a) => a.toLowerCase() === w)), `reload prefills the saved chips (${after.join(', ')})`);

  // Forget.
  await p.getByRole('button', { name: /Forget my saved taste/i }).click();
  await p.waitForTimeout(1500);
  check((await pressed()).length === 0, 'Forget clears the chips');
  await p.evaluate(() => window.localStorage.clear());
  await open();
  await p.waitForTimeout(1500);
  check((await pressed()).length === 0, 'after Forget a reload shows nothing prefilled');
  const gone = await api('GET');
  check(gone.status === 200 && !gone.j.taste, `server profile is gone (${gone.status} ${JSON.stringify(gone.j).slice(0, 80)})`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.message.slice(0, 200)); process.exit(1); });
