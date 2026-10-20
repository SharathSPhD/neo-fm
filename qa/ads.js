// Signed-out (Free listener) house-ad check on PROD, read-only: play the station, skip ahead, expect one labelled house-ad card
// that links to /gift or /pricing, and no ad inside a set (any queue response). Sends no ad events beyond what the page sends itself.
const { chromium } = require('playwright-core');
const { chromiumPath, base } = require('./common');

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
  let bad = 0;
  const check = (ok, msg) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', msg); };
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await c.newPage();
  const queues = [];
  p.on('response', async (r) => { if (/\/api\/station\/queue/.test(r.url()) && r.status() === 200) { try { queues.push(await r.json()); } catch {} } });
  await p.goto(base + '/station', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Start my station/i }).click();
  await p.waitForTimeout(6000);
  let ad = null, skips = 0;
  for (; skips < 14 && !ad; skips++) {
    ad = await p.evaluate(() => {
      const el = document.querySelector('[aria-label="Ad"]');
      if (!el) return null;
      const a = el.querySelector('a');
      return { text: el.innerText.replace(/\s+/g, ' ').slice(0, 120), href: a ? a.getAttribute('href') : null };
    });
    if (ad) break;
    const sk = p.getByRole('button', { name: /^(skip|next)/i }).first();
    if (!(await sk.count())) break;
    await sk.click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(1500);
  }
  if (!ad) {
    // Caps allow no ad until about the 3rd track and then every 6; report whether the server sent one at all.
    const anyAd = queues.some((q) => (q.items || q.tracks || q).some?.((i) => i.type === 'ad'));
    check(false, `no ad card after ${skips} skips (queue responses: ${queues.length}, any ad item sent: ${anyAd})`);
  } else {
    console.log('ad card:', JSON.stringify(ad));
    check(/^(from neo-fm|sponsored|ad)\b/i.test(ad.text), 'ad card carries a label (From neo-fm / Sponsored)');
    check(!!ad.href && /^\/(gift|pricing)/.test(ad.href), `ad links to /gift or /pricing (${ad.href})`);
  }
  let inSet = 0, adsSeen = 0;
  for (const q of queues) {
    const items = Array.isArray(q) ? q : (q.items || q.tracks || []);
    items.forEach((it, i) => {
      if (it.type !== 'ad') return;
      adsSeen++;
      const prev = items[i - 1], next = items[i + 1];
      if (prev && next && prev.set && next.set && prev.set.id === next.set.id) inSet++;
    });
  }
  check(inSet === 0, `no ad placed inside a set (${adsSeen} ad items across ${queues.length} queue responses)`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('ads check failed', e.message.split('\n')[0]); process.exit(1); });
