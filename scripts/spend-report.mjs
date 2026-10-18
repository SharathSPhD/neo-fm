#!/usr/bin/env node
// Daily spend summary for the USD 88 Claude platform budget (until 2026-11-05).
// Read-only: only GETs the Admin API cost_report / usage_report and the app's spend_ledger.
// Never touches billing settings. Secrets come from env vars only and are never printed.
//
//   MA_ADMIN_KEY                   Admin API key (sk-ant-admin...); ANT* env names are blocked. Absent => ledger-only mode.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   optional, for the app's spend_ledger (Lyria GBP reservations)
//   node scripts/spend-report.mjs [--since YYYY-MM-DD] [--budget USD] [--out path.md]
//     [--tracks N] [--listener-hours H] [--gbp-usd 1.30] [--bucket prod=USD --bucket "test/eval gate"=USD ...]
//   --tracks / --listener-hours are the window's counts (from the app or station analytics); they turn spend into unit costs.
// Baseline: USD 88 was left as of 2026-10-18, so --since defaults to that date and earlier spend is not counted.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BUDGET_USD = 88;
export const BASELINE_SINCE = "2026-10-18";
export const BUDGET_END = "2026-11-05";
const API = "https://api.anthropic.com/v1/organizations";

// Agreed split of the budget.
export const SPLIT_USD = { prod: 32, "test/eval gate": 16, dev: 10, reserve: 30 };

async function getJson(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.error?.message;
    throw new Error(`${res.status} ${res.statusText} for ${new URL(url).pathname}${detail ? `: ${detail}` : ""}`);
  }
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

// Caps are the allocation spread evenly over the weeks left in the window, so an overspent week shows up before the total does.
export function weeklyCaps(split = SPLIT_USD, since, end = new Date(BUDGET_END)) {
  const weeks = Math.max(1, (end - since) / (7 * 864e5));
  return { weeks, caps: Object.fromEntries(Object.entries(split).map(([k, v]) => [k, v / weeks])) };
}

// Lyria is billed in GBP outside the Claude credit, so unit cost is reported as Claude USD plus Lyria converted at gbpUsd.
export function unitCosts({ claudeUsd, lyriaGbp = 0, gbpUsd = 1.3, tracks, listenerHours }) {
  const total = claudeUsd + lyriaGbp * gbpUsd;
  return {
    total,
    perTrack: tracks > 0 ? total / tracks : null,
    perListenerHour: listenerHours > 0 ? total / listenerHours : null,
  };
}

const usd = (n) => `USD ${n.toFixed(2)}`;

export function renderMarkdown({ now, since, cost, tokens, ledger, notes, budget = BUDGET_USD, tracks, listenerHours, gbpUsd = 1.3, bucketSpend = {} }) {
  const L = [`# Claude platform spend`, ``, `Generated ${now.toISOString()} by \`scripts/spend-report.mjs\` (read-only).`, ``];
  L.push(`Budget: ${usd(budget)} until ${BUDGET_END}. Window reported: ${since.toISOString().slice(0, 10)} onwards.`, ``);
  if (cost) {
    const left = budget - cost.total;
    const p = projection(cost.total, since, now);
    L.push(`## Billed (Admin API cost_report)`, ``);
    L.push(`- Spent: **${usd(cost.total)}** (${((cost.total / budget) * 100).toFixed(1)}% of budget)`);
    L.push(`- Remaining: **${usd(left)}** with ${p.daysLeft.toFixed(0)} days to go`);
    const cut = now.getTime() - 7 * 864e5;
    const last7 = [...cost.byDay].filter(([d]) => new Date(d).getTime() + 864e5 > cut).reduce((a, [, v]) => a + v, 0);
    L.push(`- Last 7 days: **${usd(last7)}** (${usd(last7 / 7)}/day)`);
    L.push(`- Burn: ${usd(p.daily)}/day, projected total at end date ${usd(p.projected)}${p.projected > budget ? " **(over budget)**" : ""}`, ``);
    const { weeks, caps } = weeklyCaps(SPLIT_USD, since);
    L.push(`| Bucket | Allocation | Weekly cap (${weeks.toFixed(1)} wks) | Spent | Note |`, `|---|---|---|---|---|`);
    for (const [k, v] of Object.entries(SPLIT_USD)) {
      const s = bucketSpend[k];
      const note = s === undefined ? "per-bucket spend is not separable from the Admin API; pass --bucket" : s > v ? "**over allocation**" : "";
      L.push(`| ${k} | ${usd(v)} | ${usd(caps[k])} | ${s === undefined ? "n/a" : usd(s)} | ${note} |`);
    }
    const spendable = Object.entries(caps).filter(([k]) => k !== "reserve").reduce((a, [, v]) => a + v, 0);
    const weekFlag = last7 > spendable ? " **(over the weekly cap for prod + eval + dev; reserve is not for routine spend)**" : "";
    L.push(``, `Last 7 days ${usd(last7)} against a weekly cap of ${usd(spendable)} (prod + eval + dev)${weekFlag}.`);
    const lyriaGbp = (ledger ?? []).filter((r) => /lyria/i.test(r.provider)).reduce((a, r) => a + Number(r.reserved_gbp), 0);
    const u = unitCosts({ claudeUsd: cost.total, lyriaGbp, gbpUsd, tracks, listenerHours });
    L.push(``, `### Unit cost`, ``, `Claude billed ${usd(cost.total)} + Lyria reserved GBP ${lyriaGbp.toFixed(2)} (at ${gbpUsd} USD/GBP) = ${usd(u.total)} over the window.`, ``);
    L.push(`- Per track: ${u.perTrack === null ? "n/a (pass --tracks)" : usd(u.perTrack) + ` over ${tracks} tracks`}`);
    L.push(`- Per listener-hour: ${u.perListenerHour === null ? "n/a (pass --listener-hours)" : usd(u.perListenerHour) + ` over ${listenerHours} h`}`, ``);
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
      // The API has no completed daily data yet when the baseline day is still in progress.
      if (/ending date must be after starting date/.test(e.message)) {
        cost = sumCostUsd([]);
        notes.push("cost_report has no completed day since the baseline yet; billed spend counts as 0 until it does.");
      } else notes.push(`cost_report failed: ${e.message}`);
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
  const since = new Date(arg("--since") ?? BASELINE_SINCE);
  const budget = Number(arg("--budget") ?? BUDGET_USD);
  const num = (n) => (arg(n) === undefined ? undefined : Number(arg(n)));
  const bucketSpend = {};
  process.argv.forEach((a, i) => {
    if (a !== "--bucket") return;
    const [k, v] = process.argv[i + 1].split("=");
    bucketSpend[k] = Number(v);
  });
  const md = renderMarkdown({ ...(await collect({ since, now })), budget, tracks: num("--tracks"), listenerHours: num("--listener-hours"), gbpUsd: num("--gbp-usd"), bucketSpend });
  const out = arg("--out");
  if (out) writeFileSync(out, md);
  else console.log(md);
}
