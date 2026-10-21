// Lyric-quality showcase check (/lab/showcase), public, no login. Needs LYRIC_SHOWCASE_ENABLED=1 on the target; a 404 fails.
// Checks both language tabs, every case shows Standard and Premium text, both judge families are scored separately,
// Studio and English are labelled as not judged, and nothing overflows at 390px. Exit 1 on failure.
const { chromium } = require('playwright-core');
const { chromiumPath, base } = require('./common');

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  let bad = 0;
  const check = (ok, msg) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', msg); };
  for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['m390', { width: 390, height: 800 }]]) {
    const ctx = await b.newContext({ viewport: vp });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    for (const [lang, expected] of [['kn', 12], ['hi', 11]]) {
      const r = await p.goto(`${base}/lab/showcase?lang=${lang}`, { waitUntil: 'domcontentloaded' });
      if (!r || r.status() !== 200) { check(false, `${name} ${lang} status ${r && r.status()} (is LYRIC_SHOWCASE_ENABLED=1 on this host?)`); continue; }
      check((await p.locator('h1').innerText()).includes('Lyric quality showcase'), `${name} ${lang} heading`);
      const arts = p.locator('article');
      check((await arts.count()) === expected, `${name} ${lang} shows ${expected} cases (${await arts.count()})`);
      const full = await arts.evaluateAll((els) => els.every((e) => { const t = e.innerText; return /Standard/.test(t) && /Premium/.test(t) && e.querySelectorAll('pre').length === 2 && [...e.querySelectorAll('pre')].every((x) => x.innerText.trim().length > 50); }));
      check(full, `${name} ${lang} every case has Standard and Premium lyrics`);
      const rows = await p.locator('section[aria-label="Scores"] tbody tr').count();
      check(rows === 2, `${name} ${lang} Claude and Gemini scored in separate rows (${rows})`);
      const body = await p.locator('main').innerText();
      check(/Studio[\s\S]*not built or judged yet/i.test(body) && /English: not judged yet/.test(body), `${name} ${lang} Studio and English labelled as not judged`);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(over <= 1, `${name} ${lang} no horizontal overflow (${over}px)`);
    }
    check(errs.length === 0, `${name} no page errors${errs.length ? ': ' + errs[0] : ''}`);
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('showcase check failed', e.message.split('\n')[0]); process.exit(1); });
