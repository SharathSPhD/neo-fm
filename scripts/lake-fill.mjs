#!/usr/bin/env node
/**
 * Fills the station lake (public.pool_tracks) for one language from a briefs file: Haiku drafts, the live Sonnet polish,
 * a Lyria full render, then pool-ingest (diction gate). Resumable: each step stores its output in --out.
 *
 *   POOL_BASE_URL=https://<prod> node scripts/lake-fill.mjs --briefs briefs.json --out dir --max-gbp 6 [--dry]
 *
 * briefs.json: [{ id, language: "Kannada", code: "kn", style, text, genre, mood: [], theme: [], energy, daypart: [] }]
 * --grade premium|studio  writes the lyrics with Opus (lab arm refs_opus: Haiku draft, Opus polish with exemplars; or full_opus: three Opus
 *   drafts, an Opus pick, the same polish) and ingests with meta.lyric_grade (migration 0116 required). Default standard: unchanged.
 * Spend guard: renders stop once renders x GBP 0.25 would pass --max-gbp. Uses MA_PROD_ADMIN_SECRET. Strategy: strategy/station-pass-and-lake.md.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const BASE = (process.env.POOL_BASE_URL ?? "").replace(/\/$/, "");
const SECRET = process.env[process.env.ADMIN_SECRET_ENV ?? "MA_PROD_ADMIN_SECRET"];
const OUT = arg("--out", "lake-out");
const MAX_GBP = Number(arg("--max-gbp", "0"));
const RENDER_GBP = 0.25;
const dry = process.argv.includes("--dry");
const GRADE = arg("--grade", "standard");
if (!["standard", "premium", "studio"].includes(GRADE)) { console.error("--grade must be standard, premium or studio"); process.exit(1); }
const OPUS_ARM = GRADE === "studio" ? "full_opus" : "refs_opus";
const LYRICS_USD = { standard: 0, premium: 0.2, studio: 0.5 }[GRADE]; // per song, route meter reads about 2x low
const briefs = JSON.parse(readFileSync(arg("--briefs", "briefs.json"), "utf8"));
if (!BASE || !SECRET || !(MAX_GBP > 0)) { console.error("set POOL_BASE_URL, the admin secret env and --max-gbp"); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const state = existsSync(`${OUT}/state.json`) ? JSON.parse(readFileSync(`${OUT}/state.json`, "utf8")) : { drafts: {}, lyrics: {}, renders: {}, ingest: {} };
const save = () => writeFileSync(`${OUT}/state.json`, JSON.stringify(state, null, 1));
const call = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const slug = (b) => `lake-${b.code}-${b.id}${GRADE === "standard" ? "" : `-${GRADE}`}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
const maxRenders = Math.floor(MAX_GBP / RENDER_GBP);
if (dry) { console.log(`DRY ${briefs.length} ${GRADE} briefs, at most ${maxRenders} renders (GBP ${(maxRenders * RENDER_GBP).toFixed(2)}) plus about USD ${(Math.min(briefs.length, maxRenders) * LYRICS_USD).toFixed(2)} of Claude lyrics (route meter, true cost about 2x)`); process.exit(0); }

// 1. drafts (Haiku x1 nudge each; k=1 keeps cost at cents) 2. polish: live Sonnet (standard) or an Opus arm (premium/studio)
for (const part of chunk(briefs.filter((b) => !state.lyrics[b.id]), 5)) {
  if (GRADE === "studio") {
    // full_opus writes its own drafts, so no Haiku step.
    const r = await call("/api/admin/lyrics-harness?action=run", { arm: OPUS_ARM, cases: part.map((b) => ({ id: b.id, language: b.language, style: b.style, brief: b.text, drafts: [] })), max_usd: Math.min(4, LYRICS_USD * part.length * 2) });
    for (const x of r.results) if (x.lyrics) state.lyrics[x.id] = x.lyrics;
  } else {
    const d = await call("/api/admin/select-eval?action=drafts", { briefs: part.map((b) => ({ id: b.id, language: b.language, code: b.code, style: b.style, text: b.text })), k: 1, max_tokens: 4000, max_usd: 0.5 });
    const ok = d.results.filter((r) => r.drafts[0]);
    if (GRADE === "premium") {
      const r = await call("/api/admin/lyrics-harness?action=run", { arm: OPUS_ARM, cases: ok.map((x) => { const b = part.find((p) => p.id === x.id); return { id: x.id, language: b.language, style: b.style, brief: b.text, drafts: [x.drafts[0]] }; }), max_usd: Math.min(4, LYRICS_USD * part.length * 2) });
      for (const x of r.results) if (x.lyrics) state.lyrics[x.id] = x.lyrics;
    } else {
      const pol = await call("/api/admin/select-eval?action=polish", { cases: ok.map((r) => { const b = part.find((x) => x.id === r.id); return { id: r.id, language: b.language, style: b.style, brief: b.text, draft: r.drafts[0] }; }), max_usd: 1 });
      for (const r of pol.results) if (r.polished) state.lyrics[r.id] = r.polished;
    }
  }
  save();
  console.log("lyrics", Object.keys(state.lyrics).length, "/", briefs.length);
}

// 3. render (stops at the cap), 4. ingest
let rendered = Object.keys(state.renders).length;
for (const part of chunk(briefs.filter((b) => state.lyrics[b.id] && !state.renders[b.id]), 3)) {
  if ((rendered + part.length) > maxRenders) { console.log("render cap reached"); break; }
  const r = await call("/api/admin/test-render", { items: part.map((b) => ({ label: slug(b), language: b.code, lyrics: state.lyrics[b.id], style: b.style, score: true })) });
  for (const x of r.results) {
    const b = part.find((p) => slug(p) === x.label);
    state.renders[b.id] = x.url ? { url: x.url, diction: x.diction_match_pct } : { error: x.error };
  }
  rendered += part.length; save();
  console.log("render", r.renders_ok, "ok of", part.length, "est GBP", r.est_cost_gbp);
}
for (const b of briefs) {
  const r = state.renders[b.id];
  if (!r?.url || state.ingest[b.id]) continue;
  const audio = Buffer.from(await (await fetch(r.url)).arrayBuffer());
  const meta = { id: slug(b), source: "new_render", language: b.code, title: b.title, genre: b.genre, mood: b.mood, theme: b.theme, energy: b.energy, daypart: b.daypart, lyrics: state.lyrics[b.id], ...(GRADE !== "standard" ? { lyric_grade: GRADE } : {}) };
  const form = new FormData();
  form.set("file", new Blob([audio], { type: "audio/mpeg" }), `${meta.id}.mp3`);
  form.set("meta", JSON.stringify(meta));
  const res = await fetch(`${BASE}/api/admin/pool-ingest`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: form });
  const j = await res.json().catch(() => ({}));
  state.ingest[b.id] = { status: j.status ?? j.error ?? res.status, u: j.unorderedPct ?? null }; save();
  console.log("ingest", meta.id, state.ingest[b.id]);
}
const admitted = Object.values(state.ingest).filter((x) => x.status === "admitted").length;
console.log(`done: renders ${rendered} (est GBP ${(rendered * RENDER_GBP).toFixed(2)}), admitted ${admitted}`);
