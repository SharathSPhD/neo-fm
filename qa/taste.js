// English-first create page, taste panel and one English song with a taste set, on STAGING only (signed in).
// Needs ENGLISH_MAIN, TASTE_BRIEF and STATION_PROGRAMMES on in staging. Staging has no worker, so the song is only queued.
// Env: QA_STAGING_URL, QA_STAGING_EMAIL, QA_STAGING_PASSWORD, or QA_TASTE_FRESH=1 to sign up a throwaway @neo-fm.test user instead. Refuses prod hosts.
const { chromium } = require('playwright-core');
const { chromiumPath } = require('./common');

const base = (process.env.QA_STAGING_URL || 'https://neo-fm-staging.vercel.app').replace(/\/$/, '');
const email = process.env.QA_STAGING_EMAIL;
const pw = process.env.QA_STAGING_PASSWORD;
if ((!process.env.QA_TASTE_FRESH && (!email || !pw)) || /(^|\/\/)(www\.)?neo-fm\.com|neo-fm-web\.vercel\.app/.test(base)) {
  console.error('refusing: need a staging URL (never prod) and QA_STAGING_EMAIL / QA_STAGING_PASSWORD');
  process.exit(2);
}

(async () => {
  const b = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  let bad = 0;
  const check = (ok, msg) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', msg); };
  if (process.env.QA_TASTE_FRESH) {
    // Throwaway staging user through the app's own sign-up page, so the QA user's queued test song cannot hold the concurrent slot.
    const rnd = Math.random().toString(36).slice(2, 10);
    await p.goto(base + '/sign-up', { waitUntil: 'load', timeout: 60000 });
    await p.fill('input[name=email]', `qa-taste-${rnd}@neo-fm.test`);
    await p.fill('input[name=password]', `Qa-${rnd}-${Math.random().toString(36).slice(2, 10)}`);
    await Promise.all([p.waitForURL((u) => !/sign-up/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
    if (/sign-up/.test(new URL(p.url()).pathname)) { console.log('FAIL fresh sign-up did not sign in (email confirmation required?)', (await p.locator('[role=alert],[role=status]').allTextContents()).join(' | ').slice(0, 120)); process.exit(1); }
  } else {
    for (let a = 0; a < 2; a++) { try { await p.goto(base + '/sign-in', { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (a) throw e; } }
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', pw);
    await Promise.all([p.waitForURL((u) => !/sign-in/.test(u.pathname), { timeout: 30000 }).catch(() => {}), p.click('button[type=submit]')]);
    if (/sign-in/.test(new URL(p.url()).pathname)) { console.log('FAIL sign-in'); process.exit(1); }
  }

  await p.goto(base + '/songs/new', { waitUntil: 'load', timeout: 60000 });
  await p.waitForSelector('#prompt-language', { timeout: 20000 });
  const langs = await p.$$eval('#prompt-language option', (o) => o.map((x) => x.textContent));
  check(langs[0] === 'English', `English is the first song language (${langs.slice(0, 3).join(', ')})`);

  const summary = p.locator('details > summary', { hasText: /taste/i });
  check(await summary.count() > 0, 'taste panel is on the create page');
  if (await summary.count()) {
    await summary.first().click();
    const legends = await p.$$eval('fieldset legend', (l) => l.map((x) => x.textContent.trim()));
    check(['Genres', 'Moods', 'Instruments'].every((w) => legends.includes(w)), `taste panel shows genres, moods and instruments (${legends.join(', ')})`);
    check(await p.locator('input[maxlength="200"], textarea[maxlength="200"]').count() > 0, 'taste panel has the background line (200 chars)');
    for (const t of ['pop', 'piano', 'calm']) { const chip = p.locator('fieldset button', { hasText: new RegExp(`^${t}$`) }).first(); if (await chip.count()) await chip.click(); }
    await p.locator('input[maxlength="200"], textarea[maxlength="200"]').first().fill('QA check: grew up near the sea, likes quiet evenings');
  }

  await p.selectOption('#prompt-language', 'en');
  await p.fill('#prompt', 'QA staging check: a short English song about the first rain');
  const reqP = p.waitForRequest((r) => r.url().endsWith('/api/songs') && r.method() === 'POST', { timeout: 20000 }).catch(() => null);
  const resP = p.waitForResponse((r) => r.url().endsWith('/api/songs') && r.request().method() === 'POST', { timeout: 40000 }).catch(() => null);
  await p.locator('form button[type=submit]').last().click();
  const [req, res] = [await reqP, await resP];
  if (!req || !res) check(false, 'create song request was sent');
  else {
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
    check(body.language === 'en', `request language is en (${body.language})`);
    check(!!body.taste && (body.taste.genres || []).includes('pop') && (body.taste.instruments || []).includes('piano'), `request carries the taste set (${JSON.stringify(body.taste || null).slice(0, 120)})`);
    let j = {}; try { j = await res.json(); } catch {}
    if ([200, 201, 202].includes(res.status())) check(true, `English song accepted and queued (${res.status()})`);
    else if ([402, 403, 429].includes(res.status())) console.log('info quota or plan limit for the QA user:', res.status(), j.error || '');
    else check(false, `create song gave ${res.status()} ${JSON.stringify(j).slice(0, 160)}`);
  }

  // Station: loads and plays without page errors.
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  await p.goto(base + '/station', { waitUntil: 'networkidle', timeout: 60000 });
  const start = p.getByRole('button', { name: /Start my station/i });
  if (await start.count()) await start.click();
  await p.waitForTimeout(7000);
  const aud = await p.evaluate(() => [...document.querySelectorAll('audio')].map((a) => ({ t: +a.currentTime.toFixed(1), paused: a.paused, err: a.error && a.error.message })));
  console.log('station audio', JSON.stringify(aud));
  check(errs.length === 0, `station has no page errors ${errs.join(' | ')}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('taste check failed', e.message.split('\n')[0]); process.exit(1); });
