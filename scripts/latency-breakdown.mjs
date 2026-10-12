#!/usr/bin/env node
// Prints a per-stage latency table from job_telemetry via the admin read endpoint.
//   ADMIN_TOKEN=... node scripts/latency-breakdown.mjs [--base https://<host>] [--plan pro] [--limit 200]
// Reads only; spends nothing. Stage rows come from metrics.stages_ms; older jobs show total latency only.
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", process.env.NEO_FM_BASE_URL ?? "");
const plan = arg("plan", "");
const limit = arg("limit", "200");
const token = process.env.ADMIN_TOKEN;
if (!base || !token) { console.error("need --base (or NEO_FM_BASE_URL) and ADMIN_TOKEN"); process.exit(2); }

const url = `${base.replace(/\/$/, "")}/api/admin/q?table=job_telemetry&select=job_id,created_at,metrics&order=created_at.desc&limit=${limit}`;
const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`admin/q ${res.status}`); process.exit(1); }
const { rows } = await res.json();

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const sec = (ms) => (ms / 1000).toFixed(1);
const sel = rows.filter((r) => !plan || r.metrics?.plan === plan);
const totals = sel.map((r) => r.metrics?.latency_ms).filter((x) => typeof x === "number");
const stages = {};
for (const r of sel) for (const [k, v] of Object.entries(r.metrics?.stages_ms ?? {})) if (typeof v === "number") (stages[k] ??= []).push(v);

console.log(`jobs=${sel.length} with_total=${totals.length} with_stages=${sel.filter((r) => r.metrics?.stages_ms).length}${plan ? ` plan=${plan}` : ""}`);
console.log("stage".padEnd(18), "n".padStart(4), "p50(s)".padStart(8), "p90(s)".padStart(8), "max(s)".padStart(8));
for (const [k, xs] of Object.entries(stages).sort((a, b) => pct(b[1], 0.5) - pct(a[1], 0.5)))
  console.log(k.padEnd(18), String(xs.length).padStart(4), sec(pct(xs, 0.5)).padStart(8), sec(pct(xs, 0.9)).padStart(8), sec(Math.max(...xs)).padStart(8));
if (totals.length) console.log("TOTAL".padEnd(18), String(totals.length).padStart(4), sec(pct(totals, 0.5)).padStart(8), sec(pct(totals, 0.9)).padStart(8), sec(Math.max(...totals)).padStart(8));
