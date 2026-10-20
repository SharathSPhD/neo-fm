#!/usr/bin/env node
/**
 * Renders and ingests the raga-led pool items (pce-eval set=raga) once their PCE lyrics are done.
 *
 *   POOL_BASE_URL=https://<prod> node scripts/raga-run.mjs [--dry] [--plain] [--ab raga|plain] [--ids a,b] [--batch ragaQ1]
 *
 * Per item: POST /api/admin/provider-cap (stop on 429), test-render with the stored lyrics (brief_id + eval_batch), download the
 * signed audio, post it to pool-ingest with `raga` set and lyrics_from so the diction gate scores it. Items alternate between a
 * style prompt with the raga name and one without (the A/B for PCE_RAGA_PROMPT). Only admitted tracks carry the raga tag.
 * Reads the admin secret from MA_PROD_ADMIN_SECRET (override name with ADMIN_SECRET_ENV); never prints it.
 */
import { readFileSync } from "node:fs";

const BASE = (process.env.POOL_BASE_URL ?? "").replace(/\/$/, "");
const SECRET = process.env[process.env.ADMIN_SECRET_ENV ?? "MA_PROD_ADMIN_SECRET"];
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const dry = process.argv.includes("--dry");
const batch = arg("--batch", "ragaQ1");
const plainOnly = process.argv.includes("--plain");
const only = arg("--ids", "").split(",").filter(Boolean);
const FILE = process.env.RAGA_ITEMS ?? "/mnt/project-files/lab/raga-queue/items.json";
const SUPPORTED = ["hi", "ta", "te", "kn", "bn", "mr"];
// --ab raga|plain: render that arm for items that already have lyrics and report diction only (no ingest), for the raga-words A/B.
const ab = arg("--ab", "");
if (!dry && (!BASE || !SECRET)) { console.error("set POOL_BASE_URL and the admin secret env"); process.exit(1); }
const H = { authorization: `Bearer ${SECRET}`, "content-type": "application/json" };

const items = JSON.parse(readFileSync(FILE, "utf8")).items.filter((i) => SUPPORTED.includes(i.language) && (!only.length || only.includes(i.id)));
let n = 0;
for (const it of items) {
  const withRaga = ab ? ab === "raga" : !plainOnly && n++ % 2 === 0;
  const style = `${it.brief}. ${withRaga ? `Raga ${it.raga}. ` : ""}A sung vocal with a clear lead singer throughout, lyrics sung from the first line, no wordless alap.`;
  if (dry) { console.log("DRY", it.id, withRaga ? "raga-words" : "plain"); continue; }
  const cap = await fetch(`${BASE}/api/admin/provider-cap`, { method: "POST", headers: H, body: JSON.stringify({ provider: "lyria", class: "batch" }) });
  if (cap.status === 429) { console.log("cap reached, stopping at", it.id); break; }
  const label = `raga-${it.id}`;
  const rr = await fetch(`${BASE}/api/admin/test-render`, { method: "POST", headers: H, body: JSON.stringify({ items: [{ label, language: it.language, brief_id: label, eval_batch: batch, style, score: true }] }) });
  const body = await rr.json().catch(() => ({}));
  const res = body.results?.[0];
  if (!res?.url) { console.log(it.id, "render failed", res?.error ?? rr.status); continue; }
  if (ab) { console.log(it.id, ab, "render_diction", res.diction_match_pct ?? "-"); continue; }
  const audio = Buffer.from(await (await fetch(res.url)).arrayBuffer());
  const form = new FormData();
  form.set("file", new Blob([audio], { type: "audio/mpeg" }), `${label}.mp3`);
  form.set("meta", JSON.stringify({ id: `${label}${withRaga ? "-r" : "-p"}`, source: "new_render", language: it.language, genre: it.style, mood: [it.mood], daypart: [it.daypart], raga: it.raga, lyrics_from: { batch, brief_id: label } }));
  const ing = await fetch(`${BASE}/api/admin/pool-ingest`, { method: "POST", headers: { authorization: H.authorization }, body: form });
  const ib = await ing.json().catch(() => ({}));
  console.log(it.id, withRaga ? "raga-words" : "plain", "render_diction", res.diction_match_pct ?? "-", "ingest", ing.status, ib.status ?? ib.error ?? "", ib.unorderedPct ?? "");
}
