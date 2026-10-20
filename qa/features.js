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

    // Station steering chips, share button, shared track page and listen-together link.
    await pg.goto(`${base}/station`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2500);
    const calmer = pg.getByRole('button', { name: 'Calmer', exact: true });
    if (await calmer.count()) {
      await calmer.click();
      (await calmer.getAttribute('aria-pressed')) === 'true' ? ok(`${name} steering chip toggles`) : fail(`${name} Calmer chip did not become active`);
    } else fail(`${name} no Calmer steering chip`);
    const q = await (await pg.request.get(`${base}/api/station/queue?lang=ta&hour=17&vn=1`)).json();
    const tid = q.tracks && q.tracks.find((t) => t.id && !t.type)?.id;
    if (!tid) fail(`${name} queue gave no track to share`);
    else {
      const shared = await pg.goto(`${base}/t/${tid}`, { waitUntil: 'domcontentloaded' });
      shared.status() === 200 ? ok(`${name} shared track page 200`) : fail(`${name} /t/${tid} ${shared.status()}`);
      const tg = await pg.goto(`${base}/t/${tid}?at=20&ts=${Date.now()}`, { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(2500);
      const seek = await pg.evaluate(() => { const a = document.querySelector('audio'); return a ? a.currentTime : -1; });
      tg.status() === 200 && seek !== -1 ? ok(`${name} listen-together link loads (audio at ${Math.round(seek)}s)`) : fail(`${name} listen-together link ${tg.status()} audio ${seek}`);
    }
    // Bengali station page.
    await ctx.addCookies([{ name: 'neo-fm-lang', value: 'bn', url: base }]);
    await pg.goto(`${base}/station`, { waitUntil: 'domcontentloaded' });
    const bn = await pg.evaluate(() => (document.querySelector('h1') || {}).innerText || '');
    /[ঀ-৿]/.test(bn) ? ok(`${name} Bengali station heading`) : fail(`${name} Bengali heading not Bengali: ${bn.slice(0, 30)}`);
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('features failed', e.message); process.exit(1); });
