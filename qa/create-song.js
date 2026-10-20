// Create-song flow on STAGING only: a signed-in prompt submission is accepted and queued, the song page opens, and a bad body is rejected.
// Staging has no music or lyrics provider keys and no worker, so the job is only queued; nothing is generated and nothing is spent.
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

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath() });
  const p = await (await b.newContext()).newPage();
  for (let a = 0; a < 2; a++) { try { await p.goto(base + '/sign-in', { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (a) throw e; } }
  await p.fill('input[name=email]', email);
  await p.fill('input[name=password]', pw);
  await Promise.all([p.waitForURL((u) => !/sign-in/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
  if (/sign-in/.test(new URL(p.url()).pathname)) { console.log('FAIL sign-in'); process.exit(1); }
  await p.goto(base + '/songs/new', { waitUntil: 'load', timeout: 60000 });
  let bad = 0;
  const post = (body) => p.evaluate(async (bd) => {
    const res = await fetch('/api/songs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bd) });
    let j = {}; try { j = await res.json(); } catch {}
    return { status: res.status, j };
  }, body);

  const empty = await post({ prompt: '   ', language: 'kn', style_family: 'kannada-folk', target_duration_seconds: 30 });
  if (empty.status === 400) console.log('ok   blank prompt rejected (400)');
  else { bad++; console.log('FAIL blank prompt gave', empty.status); }

  const made = await post({ prompt: 'QA staging check: a short folk song about the first rain', language: 'kn', style_family: 'kannada-folk', target_duration_seconds: 30 });
  const id = made.j.song_id;
  if ([200, 201, 202].includes(made.status) && made.j.job_id && id) {
    console.log('ok   song accepted and queued, status', made.j.status);
    const r = await p.goto(`${base}/songs/${id}`, { waitUntil: 'load', timeout: 60000 });
    const h1 = await p.evaluate(() => (document.querySelector('h1') || {}).innerText || '');
    r.status() === 200 && h1 ? console.log('ok   song page opens:', h1.slice(0, 40)) : (bad++, console.log('FAIL song page', r.status(), h1));
  } else if ([402, 403, 429].includes(made.status)) {
    console.log('info quota or plan limit reached for the QA user:', made.status, made.j.error || '');
  } else { bad++; console.log('FAIL create song', made.status, JSON.stringify(made.j).slice(0, 160)); }
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('create-song failed', e.message.split('\n')[0]); process.exit(1); });
