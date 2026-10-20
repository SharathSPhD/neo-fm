// Station queue checks: every launch language carries a spoken programme or host-link at each daypart.
const { base } = require('./common');
const langs = ['hi', 'ta', 'te', 'kn', 'mr'];
(async () => {
  let bad = 0;
  for (const l of langs) {
    for (const h of [6, 17, 23]) {
      const res = await fetch(`${base}/api/station/queue?lang=${l}&hour=${h}&vn=3`);
      const j = await res.json().catch(() => ({}));
      const t = j.tracks || [];
      const v = t.filter((i) => i.type === 'voice').map((i) => i.voice && i.voice.lineId);
      const ok = res.status === 200 && t.length >= 8 && v.length >= 1;
      if (!ok) bad++;
      console.log(ok ? 'ok ' : 'BAD', l, h, res.status, t.length, JSON.stringify(v));
    }
  }
  process.exit(bad ? 1 : 0);
})();
