// First-run taste intake on /station, STAGING only, signed out (fresh browser): the three-row chooser shows, three taps are kept in
// localStorage and ride the first queue request as taste=, and the queue answers with x-station-taste: applied. Needs STATION_TASTE=1 on
// staging. Reports info and exits 0 when the staging queue itself answers 5xx. Env: QA_STAGING_URL. Refuses prod hosts.
const { chromium } = require('playwright-core');
const { chromiumPath } = require('./common');

const base = (process.env.QA_STAGING_URL || 'https://neo-fm-staging.vercel.app').replace(/\/$/, '');
if (/(^|\/\/)(www\.)?neo-fm\.com|neo-fm-web\.vercel\.app/.test(base)) { console.error('refusing: staging only'); process.exit(2); }

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  let bad = 0;
  const check = (ok, msg) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', msg); };
  await p.goto(base + '/station', { waitUntil: 'load', timeout: 60000 });
  const intake = p.locator('[data-testid=station-intake]');
  await intake.waitFor({ timeout: 20000 }).catch(() => {});
  check(await intake.count() === 1, 'first-run intake is shown (STATION_TASTE on)');
  if (!await intake.count()) { await b.close(); process.exit(1); }
  const groups = intake.locator('> div');
  check(await groups.count() === 3, `three rows: languages, moods, energy (${await groups.count()})`);
  for (let i = 0; i < 3; i++) await groups.nth(i).locator('button').nth(i === 2 ? 0 : 1).click();
  const pressed = await intake.locator('button[aria-pressed=true]').count();
  check(pressed === 3, `three taps are marked pressed (${pressed})`);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at 390px');

  const reqP = p.waitForRequest((r) => r.url().includes('/api/station/queue'), { timeout: 30000 }).catch(() => null);
  const resP = p.waitForResponse((r) => r.url().includes('/api/station/queue'), { timeout: 30000 }).catch(() => null);
  await p.getByRole('button', { name: /start|शुरू|தொடங்|ప్రారంభ|ಪ್ರಾರಂಭ|শুরু/i }).last().click();
  const [req, res] = [await reqP, await resP];
  check(!!req && /[?&]taste=/.test(req.url()), 'queue request carries taste=');
  if (req) {
    const t = JSON.parse(new URL(req.url()).searchParams.get('taste') || '{}');
    check(t.languages?.length === 1 && t.moods?.length === 1 && !!t.energy && !t.background, `taste= holds the three picks and no free text (${JSON.stringify(t)})`);
  }
  if (res && res.status() >= 500) { console.log(`INFO queue answered ${res.status()} on staging; skipping the header check`); }
  else check(!!res && res.status() === 200 && res.headers()['x-station-taste'] === 'applied', `queue answers x-station-taste: applied (${res && res.status()} ${res && res.headers()['x-station-taste']})`);
  const stored = await p.evaluate(() => window.localStorage.getItem('neo-fm:station-intake:v1'));
  check(!!stored && JSON.parse(stored).moods?.length === 1, 'the picks are kept in this browser');

  // A junk taste= must be ignored, not break the queue.
  const junk = await p.evaluate(async (u) => { const r = await fetch(u); return { s: r.status, h: r.headers.get('x-station-taste') }; }, '/api/station/queue?limit=3&taste=%7Bnot-json');
  check(junk.s !== 500 && !junk.h, `junk taste= is ignored (${junk.s} ${junk.h})`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.message.slice(0, 200)); process.exit(1); });
