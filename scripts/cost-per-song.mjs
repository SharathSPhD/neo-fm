#!/usr/bin/env node
// Applies a prices JSON to the token/count usage stored in job_telemetry.metrics.cost and prints cost per song by plan.
//   ADMIN_TOKEN=... node scripts/cost-per-song.mjs --prices prices.json [--base https://<host>] [--limit 200]
//   node scripts/cost-per-song.mjs --prices prices.json --file rows.json      (offline, rows from /api/admin/q)
// Prices never live in the database; see prices.example.json below. All amounts are in the one currency you choose.
//   {
//     "currency": "GBP",
//     "usd_to_currency": 0.78,                       // only used when an agent session reports list_cost in USD
//     "lyria_per_render": { "full": 0.25 },          // per successful render
//     "per_million_tokens": {                        // [input, output, cache_read, cache_write] per model
//       "claude-sonnet-5-5": [3, 15, 0.3, 3.75],
//       "gemini-3.8-flash": [0.3, 2.5, 0.075, 0]
//     },
//     "infra_per_song": 0.005
//   }
import { readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const pricesPath = arg("prices", "");
if (!pricesPath) { console.error("need --prices <file.json> (see header comment for the shape)"); process.exit(2); }
const P = JSON.parse(readFileSync(pricesPath, "utf8"));
const file = arg("file", "");
let rows;
if (file) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  rows = Array.isArray(j) ? j : j.rows;
} else {
  const base = arg("base", process.env.NEO_FM_BASE_URL ?? "");
  const token = process.env.ADMIN_TOKEN;
  if (!base || !token) { console.error("need --base and ADMIN_TOKEN, or --file"); process.exit(2); }
  const res = await fetch(`${base.replace(/\/$/, "")}/api/admin/q?table=job_telemetry&select=job_id,created_at,metrics&order=created_at.desc&limit=${arg("limit", "200")}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`admin/q ${res.status}`); process.exit(1); }
  rows = (await res.json()).rows;
}
if (!Array.isArray(rows)) { console.error("no rows"); process.exit(1); }

const tokCost = (u) => {
  const p = P.per_million_tokens?.[u.model];
  if (!p) return { cost: 0, missing: u.model };
  return { cost: ((u.in ?? 0) * p[0] + (u.out ?? 0) * p[1] + (u.cache_read ?? 0) * (p[2] ?? 0) + (u.cache_write ?? 0) * (p[3] ?? 0)) / 1e6 };
};

const byPlan = {};
const missing = new Set();
for (const r of rows) {
  const m = r?.metrics, c = m?.cost;
  if (!c) continue; // jobs from before cost recording have no usage; skip rather than guess
  let agent = 0;
  const s = c.agent_session;
  if (s?.list_cost && s.list_cost.currency === "USD") agent = (Number(s.list_cost.amount) / 100) * (P.usd_to_currency ?? 1);
  else if (s?.list_cost) agent = Number(s.list_cost.amount) / 100; // already in the price currency
  const polish = c.polish ? tokCost(c.polish) : { cost: 0 };
  const qa = c.qa ? tokCost(c.qa) : { cost: 0 };
  if (polish.missing) missing.add(polish.missing);
  if (qa.missing) missing.add(qa.missing);
  const lyria = (c.lyria_renders ?? 0) * (P.lyria_per_render?.full ?? 0);
  const total = agent + polish.cost + qa.cost + lyria + (P.infra_per_song ?? 0);
  (byPlan[m.plan ?? "unknown"] ??= []).push({ total, agent, polish: polish.cost, qa: qa.cost, lyria });
}
const avg = (xs, k) => xs.reduce((a, x) => a + x[k], 0) / xs.length;
console.log(`currency=${P.currency ?? "?"} jobs_with_cost=${Object.values(byPlan).reduce((a, x) => a + x.length, 0)} of ${rows.length}`);
console.log("plan".padEnd(10), "n".padStart(4), "total".padStart(9), "agent".padStart(9), "polish".padStart(9), "qa".padStart(9), "lyria".padStart(9));
for (const [plan, xs] of Object.entries(byPlan))
  console.log(plan.padEnd(10), String(xs.length).padStart(4), ...["total", "agent", "polish", "qa", "lyria"].map((k) => avg(xs, k).toFixed(4).padStart(9)));
if (!Object.keys(byPlan).length) console.log("no jobs with metrics.cost yet (appears after the cost-recording PR deploys)");
if (missing.size) console.log(`no price for model(s): ${[...missing].join(", ")} (counted as 0)`);
