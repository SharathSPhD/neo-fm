// Lyric grades (migration 0115, LYRIC_GRADES=1) on STAGING only: fresh throwaway Free user has no allowance and no add-on credit, so the
// picker must offer Standard only, a Premium request must come back Standard, and the add-on Checkout must start (or say it is not on sale).
// Needs LYRIC_GRADES=1 and migration 0115 on staging. Env: QA_STAGING_URL. Never prints credentials. Refuses prod hosts.
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
  await p.fill('input[name=email]', `qa-grade-${rnd}@neo-fm.test`);
  await p.fill('input[name=password]', `Qa-${rnd}-${Math.random().toString(36).slice(2, 10)}`);
  await Promise.all([p.waitForURL((u) => !/sign-up/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
  if (/sign-up/.test(new URL(p.url()).pathname)) { console.log('FAIL fresh sign-up did not sign in'); process.exit(1); }

  await p.goto(base + '/songs/new', { waitUntil: 'load', timeout: 60000 });
  await p.waitForSelector('#prompt-language', { timeout: 20000 });
  const picker = p.locator('#prompt-grade');
  check(await picker.count() > 0, 'lyrics grade picker is shown (LYRIC_GRADES is on in staging)');
  if (await picker.count()) {
    check((await picker.inputValue()) === 'standard', 'picker starts on Standard');
    const disabled = await picker.locator('option').evaluateAll((o) => o.filter((x) => x.disabled).map((x) => x.value));
    check(disabled.includes('premium') && disabled.includes('studio'), `Premium and Studio are disabled with no credit (${disabled.join(',')})`);
  }

  const post = (url, body) => p.evaluate(async ([u, bd]) => { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bd) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [url, body]);
  const song = await post('/api/songs', { prompt: 'a calm morning song about the first rain', language: 'kn', style_family: 'pop', target_duration_seconds: 60, lyric_grade: 'premium' });
  if (song.status === 202) check(song.j.lyric_grade === 'standard', `a Premium request with no credit is granted Standard (${song.j.lyric_grade})`);
  else console.log('info', `song request returned ${song.status} ${JSON.stringify(song.j).slice(0, 80)} (plan or concurrency limit; grade not checked)`);

  const addon = await post('/api/billing/checkout', { addon: 'premium' });
  check(addon.status === 200 ? /^https:\/\/checkout\.stripe\.com\//.test(addon.j.url || '') : addon.status === 503 && addon.j.error === 'addon_unavailable', `add-on checkout starts or reports not on sale (${addon.status} ${addon.j.error || ''})`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.message.slice(0, 200)); process.exit(1); });
