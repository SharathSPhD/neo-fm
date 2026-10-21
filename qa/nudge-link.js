// Taste-aware nudge deep link, STAGING only, signed out: /station?lang=kn&moods=calm,romantic skips the first-visit picker and the first
// queue request carries lang=kn and tags=calm,romantic; junk params are ignored. With QA_CRON_SECRET the daily nudge endpoint is also
// called and must answer JSON (a no-op `{enabled:false}` is fine while STATION_NUDGE_ENABLED is off). Env: QA_STAGING_URL. Refuses prod hosts.
const { chromium } = require('playwright-core');
const { chromiumPath } = require('./common');

const base = (process.env.QA_STAGING_URL || 'https://neo-fm-staging.vercel.app').replace(/\/$/, '');
if (/(^|\/\/)(www\.)?neo-fm\.com|neo-fm-web\.vercel\.app/.test(base)) { console.error('refusing: staging only'); process.exit(2); }

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  let bad = 0;
  const check = (ok, msg) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', msg); };

  const open = async (path) => {
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { window.localStorage.clear(); } catch {} });
    const reqP = p.waitForRequest((r) => r.url().includes('/api/station/queue'), { timeout: 30000 }).catch(() => null);
    await p.goto(base + path, { waitUntil: 'load', timeout: 60000 });
    const req = await reqP;
    return { p, req, picker: await p.locator('section[aria-label]').filter({ has: p.locator('[aria-pressed]') }).count() };
  };

  const good = await open('/station?lang=kn&moods=calm,romantic');
  check(!!good.req, 'link opens straight into playback (a queue request is made)');
  const u = good.req ? new URL(good.req.url()) : null;
  check(u?.searchParams.get('lang') === 'kn', `queue request carries lang=kn (${u?.searchParams.get('lang')})`);
  check(u?.searchParams.get('tags') === 'calm,romantic', `queue request carries tags=calm,romantic (${u?.searchParams.get('tags')})`);
  check(await good.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at 390px');
  await good.p.close();

  const junk = await open('/station?lang=xx&moods=zzz,calm,joyful,devotional');
  const j = junk.req ? new URL(junk.req.url()) : null;
  check(!j || !j.searchParams.get('lang'), `unknown language is dropped (${j?.searchParams.get('lang')})`);
  check(!j || (j.searchParams.get('tags') || '').split(',').filter(Boolean).length <= 2, `at most two moods are kept (${j?.searchParams.get('tags')})`);
  await junk.p.close();

  if (process.env.QA_CRON_SECRET) {
    const r = await ctx.request.get(base + '/api/notifications/station-nudge', { headers: { authorization: `Bearer ${process.env.QA_CRON_SECRET}` } });
    const body = await r.json().catch(() => null);
    check(r.status() === 200 && body && typeof body.enabled === 'boolean', `nudge endpoint answers JSON (${r.status()} ${JSON.stringify(body)})`);
  } else console.log('INFO QA_CRON_SECRET not set; skipped the endpoint check');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.message.slice(0, 200)); process.exit(1); });
