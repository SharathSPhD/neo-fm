// Feature checks for the dedicate-this-hour link and the push opt-in. Public, no login. Exit 1 on failure.
const { chromium } = require('playwright-core');
const { chromiumPath, base } = require('./common');

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  let bad = 0;
  const fail = (m) => { bad++; console.log('FAIL', m); };
  const ok = (m) => console.log('ok  ', m);
  for (const [name, vp] of [['desk', { width: 1280, height: 800 }], ['m390', { width: 390, height: 800 }]]) {
    const ctx = await b.newContext({ viewport: vp });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { window.open = (u) => { window.__opened = String(u); return null; }; });
    await pg.goto(`${base}/station?s=raat&for=Meera`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2500);
    const banner = await pg.getByRole('status').filter({ hasText: /meera/i }).count();
    banner ? ok(`${name} dedication banner shows`) : fail(`${name} dedication banner missing for ?for=Meera`);
    await pg.goto(`${base}/station?for=${encodeURIComponent('<img src=x onerror=alert(1)> http://evil.example')}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1500);
    const leaked = (await pg.locator("img[src='x']").count()) + (await pg.locator('main').getByText('evil.example').count());
    leaked ? fail(`${name} markup or link in name reached the page`) : ok(`${name} hostile name stripped`);
    await pg.goto(`${base}/station`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2500);
    const btn = pg.getByRole('button', { name: 'Dedicate this hour' });
    if (!(await btn.count())) { fail(`${name} no "Dedicate this hour" button`); await ctx.close(); continue; }
    await btn.first().click();
    await pg.getByPlaceholder('Who is this hour for?').fill('Asha');
    await pg.getByRole('button', { name: 'Dedicate this hour' }).last().click();
    const url = decodeURIComponent(await pg.evaluate(() => window.__opened || ''));
    url.includes('wa.me') && url.includes('for=Asha') && url.includes('utm_campaign=dedicate')
      ? ok(`${name} WhatsApp dedication link built`) : fail(`${name} WhatsApp link wrong: ${url.slice(0, 120)}`);
    // Push opt-in is behind sign-in; signed out must send you to sign-in, not 5xx.
    const r = await pg.goto(`${base}/account/notifications`, { waitUntil: 'domcontentloaded' });
    const key = await pg.request.get(`${base}/api/notifications/push/key`);
    (r.status() < 500 && key.status() < 500)
      ? ok(`${name} push pages respond (${r.status()}, key ${key.status()})`) : fail(`${name} push opt-in 5xx`);
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('features failed', e.message); process.exit(1); });
