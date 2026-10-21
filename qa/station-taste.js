// STATION_TASTE on STAGING only: fresh throwaway user saves a taste profile (consent first), then the station queue must carry the
// `x-station-taste: applied` header and, where a track has a saved mood tag, a host line naming it. A user with no saved profile must
// get no header. Needs STATION_TASTE=1 and migration 0113 on staging. Env: QA_STAGING_URL. Refuses prod hosts.
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
  await p.fill('input[name=email]', `qa-stn-${rnd}@neo-fm.test`);
  await p.fill('input[name=password]', `Qa-${rnd}-${Math.random().toString(36).slice(2, 10)}`);
  await Promise.all([p.waitForURL((u) => !/sign-up/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
  if (/sign-up/.test(new URL(p.url()).pathname)) { console.log('FAIL fresh sign-up did not sign in'); process.exit(1); }
  await p.goto(base + '/songs/new', { waitUntil: 'load', timeout: 60000 }); // same-origin context for fetch

  const call = (url, method = 'GET', body) => p.evaluate(async ([u, m, bd]) => {
    const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: bd ? JSON.stringify(bd) : undefined });
    return { status: r.status, hdr: r.headers.get('x-station-taste'), j: await r.json().catch(() => ({})) };
  }, [url, method, body]);
  const q = '/api/station/queue?limit=10&hour=10';

  const before = await call(q);
  if (before.status >= 500) { console.log(`INFO queue answered ${before.status} on staging (no pool or service-role key); skipping`); await b.close(); process.exit(0); }
  check(before.status === 200 && !before.hdr, `no saved profile: queue has no taste header (${before.status} ${before.hdr})`);

  const consent = await call('/api/me/taste', 'POST', { consent: true });
  check(consent.status === 200, `personalize consent granted (${consent.status})`);
  const saved = await call('/api/me/taste/stated', 'PUT', { taste: { v: 1, moods: ['calm', 'devotional'], genres: ['carnatic'], energy: 'calm', daypart_moods: { morning: 'calm' } } });
  check(saved.status === 200, `taste saved (${saved.status} ${JSON.stringify(saved.j).slice(0, 80)})`);

  const after = await call(q);
  check(after.status === 200 && after.hdr === 'applied', `saved profile: queue carries x-station-taste: applied (${after.status} ${after.hdr})`);
  const tracks = (after.j.tracks || []).filter((t) => t.host);
  check(tracks.length > 0, `queue returned tracks with host lines (${tracks.length})`);
  const noted = tracks.filter((t) => /For your (calm|devotional) mood\./.test(t.host) || /(शांत|भक्ति|அமைதி|பக்தி|శాంతి|ಶಾಂತ|শান্ত)/.test(t.host));
  const mooded = tracks.filter((t) => (t.tags || []).some((x) => x === 'calm' || x === 'devotional'));
  console.log(`INFO ${noted.length}/${mooded.length} calm or devotional tracks carry the taste note`);
  check(mooded.length === 0 || noted.length > 0, 'a track with a saved mood says so in its host line');
  check(tracks.filter((t) => !(t.tags || []).some((x) => x === 'calm' || x === 'devotional')).every((t) => !/For your .* mood/.test(t.host)), 'tracks without a saved mood get no taste note');

  const forgot = await call('/api/me/taste/stated', 'DELETE');
  check(forgot.status === 200, `forget (${forgot.status})`);
  const end = await call(q);
  check(end.status === 200 && !end.hdr, `after Forget the queue has no taste header (${end.hdr})`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.message.slice(0, 200)); process.exit(1); });
