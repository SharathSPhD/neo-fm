#!/usr/bin/env node
// Prints a per-stage latency table from job_telemetry via the admin read endpoint.
//   ADMIN_TOKEN=... node scripts/latency-breakdown.mjs [--base https://<host>] [--plan pro] [--limit 200]
//   node scripts/latency-breakdown.mjs --file rows.json   (offline)
// Reads only; spends nothing. Stage rows come from metrics.stages_ms; older jobs show total latency only.
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", process.env.NEO_FM_BASE_URL ?? "");
const plan = arg("plan", "");
const limit = arg("limit", "200");
const file = arg("file", "");
const token = process.env.ADMIN_TOKEN;
let rows;
if (file) {
  // Offline mode: a saved /api/admin/q response ({ rows: [...] }) or a bare array of job_telemetry rows.
  const { readFileSync } = await import("node:fs");
  const j = JSON.parse(readFileSync(file, "utf8"));
  rows = Array.isArray(j) ? j : j.rows;
} else {
  if (!base || !token) { console.error("need --base (or NEO_FM_BASE_URL) and ADMIN_TOKEN, or --file"); process.exit(2); }
  const url = `${base.replace(/\/$/, "")}/api/admin/q?table=job_telemetry&select=job_id,created_at,metrics&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`admin/q ${res.status}`); process.exit(1); }
  rows = (await res.json()).rows;
}
if (!Array.isArray(rows)) { console.error("no rows in response"); process.exit(1); }

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const sec = (ms) => (ms / 1000).toFixed(1);
const sel = rows.filter((r) => r && (!plan || r.metrics?.plan === plan));
const totals = sel.map((r) => r.metrics?.latency_ms).filter((x) => typeof x === "number" && Number.isFinite(x));
const stages = {};
// Stages a job did not observe are simply absent (not zero); skip anything that is not a finite non-negative number.
for (const r of sel) {
  const sm = r.metrics?.stages_ms;
  if (!sm || typeof sm !== "object" || Array.isArray(sm)) continue;
  for (const [k, v] of Object.entries(sm)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) (stages[k] ??= []).push(v);
}

if (!Object.keys(stages).length) console.log("no stage timings yet (stages_ms appears on jobs finished after PR #28 deployed); showing totals only");
console.log(`jobs=${sel.length} with_total=${totals.length} with_stages=${sel.filter((r) => r.metrics?.stages_ms).length}${plan ? ` plan=${plan}` : ""}`);
console.log("stage".padEnd(18), "n".padStart(4), "p50(s)".padStart(8), "p90(s)".padStart(8), "max(s)".padStart(8));
for (const [k, xs] of Object.entries(stages).sort((a, b) => pct(b[1], 0.5) - pct(a[1], 0.5)))
  console.log(k.padEnd(18), String(xs.length).padStart(4), sec(pct(xs, 0.5)).padStart(8), sec(pct(xs, 0.9)).padStart(8), sec(Math.max(...xs)).padStart(8));
if (totals.length) console.log("TOTAL".padEnd(18), String(totals.length).padStart(4), sec(pct(totals, 0.5)).padStart(8), sec(pct(totals, 0.9)).padStart(8), sec(Math.max(...totals)).padStart(8));
