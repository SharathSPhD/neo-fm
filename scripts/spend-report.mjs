#!/usr/bin/env node
// Daily spend summary for the USD 88 Claude platform budget (until 2026-11-05).
// Read-only: only GETs the Admin API cost_report / usage_report and the app's spend_ledger.
// Never touches billing settings. Secrets come from env vars only and are never printed.
//
//   MA_ADMIN_KEY                   Admin API key (sk-ant-admin...); ANT* env names are blocked. Absent => ledger-only mode.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   optional, for the app's spend_ledger (Lyria GBP reservations)
//   node scripts/spend-report.mjs [--since YYYY-MM-DD] [--out path.md]

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BUDGET_USD = 88;
export const BUDGET_END = "2026-11-05";
const API = "https://api.anthropic.com/v1/organizations";

// Agreed split of the budget.
export const SPLIT_USD = { prod: 32, "test/eval gate": 16, dev: 10, reserve: 30 };

async function getJson(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${new URL(url).pathname}`);
  return res.json();
}

async function paged(path, params, headers, fetchImpl) {
  const rows = [];
  let page;
  do {
    const q = new URLSearchParams(params);
    if (page) q.set("page", page);
    const body = await getJson(`${API}/${path}?${q}`, headers, fetchImpl);
    rows.push(...(body.data ?? []));
    page = body.has_more ? body.next_page : undefined;
  } while (page);
  return rows;
}

// cost_report amounts are decimal strings in cents.
export function sumCostUsd(buckets) {
  const byDay = new Map();
  const byModel = new Map();
  for (const b of buckets) {
    const day = b.starting_at.slice(0, 10);
    for (const r of b.results ?? []) {
      const usd = Number(r.amount) / 100;
      if (!Number.isFinite(usd)) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + usd);
      const m = r.model ?? "(unattributed)";
      byModel.set(m, (byModel.get(m) ?? 0) + usd);
    }
  }
  const total = [...byDay.values()].reduce((a, b) => a + b, 0);
  return { total, byDay, byModel };
}

export function sumTokens(buckets) {
  const byModel = new Map();
  for (const b of buckets) {
    for (const r of b.results ?? []) {
      const m = r.model ?? "(unknown)";
      const t = byModel.get(m) ?? { input: 0, output: 0 };
      t.input += (r.uncached_input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0);
      t.output += r.output_tokens ?? 0;
      byModel.set(m, t);
    }
  }
  return byModel;
}

export function projection(spentUsd, since, now) {
  const days = Math.max(1, (now - since) / 864e5);
  const daily = spentUsd / days;
  const left = Math.max(0, (new Date(BUDGET_END) - now) / 864e5);
  return { daily, projected: spentUsd + daily * left, daysLeft: left };
}

const usd = (n) => `USD ${n.toFixed(2)}`;

export function renderMarkdown({ now, since, cost, tokens, ledger, notes }) {
  const L = [`# Claude platform spend`, ``, `Generated ${now.toISOString()} by \`scripts/spend-report.mjs\` (read-only).`, ``];
  L.push(`Budget: ${usd(BUDGET_USD)} until ${BUDGET_END}. Window reported: ${since.toISOString().slice(0, 10)} onwards.`, ``);
  if (cost) {
    const left = BUDGET_USD - cost.total;
    const p = projection(cost.total, since, now);
    L.push(`## Billed (Admin API cost_report)`, ``);
    L.push(`- Spent: **${usd(cost.total)}** (${((cost.total / BUDGET_USD) * 100).toFixed(1)}% of budget)`);
    L.push(`- Remaining: **${usd(left)}** with ${p.daysLeft.toFixed(0)} days to go`);
    L.push(`- Burn: ${usd(p.daily)}/day, projected total at end date ${usd(p.projected)}${p.projected > BUDGET_USD ? " **(over budget)**" : ""}`, ``);
    L.push(`| Bucket | Allocation | Note |`, `|---|---|---|`);
    for (const [k, v] of Object.entries(SPLIT_USD)) L.push(`| ${k} | ${usd(v)} | per-bucket spend is not separable without separate workspaces or keys |`);
    L.push(``, `### By model`, ``, `| Model | USD |`, `|---|---|`);
    for (const [m, v] of [...cost.byModel].sort((a, b) => b[1] - a[1])) L.push(`| ${m} | ${v.toFixed(2)} |`);
    L.push(``, `### By day (last 14)`, ``, `| Day | USD |`, `|---|---|`);
    for (const [d, v] of [...cost.byDay].sort().slice(-14)) L.push(`| ${d} | ${v.toFixed(2)} |`);
    L.push(``);
  } else {
    L.push(`## Billed spend: not available`, ``, `\`MA_ADMIN_KEY\` is not set in this environment, so no billed figures are reported here. Add it as a cloud env var (never in chat) and rerun. Until then, figures below are the app's own ledger only.`, ``);
  }
  if (tokens?.size) {
    L.push(`## Tokens (usage_report/messages)`, ``, `| Model | Input | Output |`, `|---|---|---|`);
    for (const [m, t] of tokens) L.push(`| ${m} | ${t.input.toLocaleString("en-US")} | ${t.output.toLocaleString("en-US")} |`);
    L.push(``);
  }
  L.push(`## App ledger (Lyria, GBP, separate from the Claude credit)`, ``);
  if (ledger?.length) {
    L.push(`| Provider | Reserved GBP | Updated |`, `|---|---|---|`);
    for (const r of ledger) L.push(`| ${r.provider} | ${Number(r.reserved_gbp).toFixed(2)} | ${r.updated_at} |`);
    L.push(``, `Reservations are estimates (about GBP 0.25 per Lyria render), not billed amounts. Prod ceiling is LYRIA_BUDGET_GBP=40.`, ``);
  } else {
    L.push(`Not available (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set or the query failed). Per-song estimates from the handover: about GBP 0.1 Claude and infra, about GBP 0.25 per Lyria render.`, ``);
  }
  if (notes.length) L.push(`## Notes`, ``, ...notes.map((n) => `- ${n}`), ``);
  return L.join("\n");
}

export async function collect({ env = process.env, fetchImpl = fetch, now = new Date(), since }) {
  const notes = [];
  let cost, tokens, ledger;
  const key = env.MA_ADMIN_KEY;
  if (key) {
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    const range = { starting_at: since.toISOString(), ending_at: now.toISOString() };
    try {
      cost = sumCostUsd(await paged("cost_report", { ...range, bucket_width: "1d", limit: "31", "group_by[]": "description" }, headers, fetchImpl));
    } catch (e) {
      notes.push(`cost_report failed: ${e.message}`);
    }
    try {
      tokens = sumTokens(await paged("usage_report/messages", { ...range, bucket_width: "1d", limit: "31", "group_by[]": "model" }, headers, fetchImpl));
    } catch (e) {
      notes.push(`usage_report failed: ${e.message}`);
    }
  }
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      ledger = await getJson(`${env.SUPABASE_URL}/rest/v1/spend_ledger?select=provider,reserved_gbp,updated_at`, {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      }, fetchImpl);
    } catch (e) {
      notes.push(`spend_ledger read failed: ${e.message}`);
    }
  }
  return { now, since, cost, tokens, ledger, notes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const now = new Date();
  const since = new Date(arg("--since") ?? now.getTime() - 30 * 864e5);
  const md = renderMarkdown(await collect({ since, now }));
  const out = arg("--out");
  if (out) writeFileSync(out, md);
  else console.log(md);
}
