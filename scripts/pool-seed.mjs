#!/usr/bin/env node
/**
 * Seeds the station pool (public.pool_tracks) from renders that already exist as files.
 *
 *   POOL_BASE_URL=https://<prod> ADMIN_SECRET_ENV=MA_PROD_ADMIN_SECRET node scripts/pool-seed.mjs [--dry] [--only quality|occasion]
 *
 * Reads /mnt/project-files (override with POOL_FILES_DIR). Each file is posted to /api/admin/pool-ingest, which stores the
 * audio, applies the diction gate and admits or rejects it. No Lyria call is made here.
 *  - quality/*: scored earlier by the same Gemini transcript method (matchPct); the stored score is passed as diction_u, so a
 *    track admitted here has an ordered score >= 80, which is stricter than the order-free score the gate normally uses.
 *  - samples/occasion/*: the sung lyrics are in scripts/pool-seed-occasion.json and the route scores them (one Gemini call each).
 * Tags for the quality files come from Claude Haiku over the transcript, kept to the closed vocabulary; set TAG_MODEL to change it.
 */
import { readFileSync, existsSync } from "node:fs";

const DIR = process.env.POOL_FILES_DIR ?? "/mnt/project-files";
const BASE = (process.env.POOL_BASE_URL ?? "").replace(/\/$/, "");
const SECRET = process.env[process.env.ADMIN_SECRET_ENV ?? "MA_PROD_ADMIN_SECRET"];
const dry = process.argv.includes("--dry");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const TAG_MODEL = process.env.TAG_MODEL ?? "claude-haiku-5-5";
const MOODS = ["devotional", "joyful", "nostalgic", "romantic", "festive", "calm", "energetic", "melancholic", "celebratory", "playful"];
const THEMES = ["diwali", "wedding", "anniversary", "birthday", "mother", "rakhi", "farewell", "new-year", "harvest", "monsoon", "bhakti", "friendship", "travel", "village", "love", "spring"];
const LANG = { Hindi: "hi", Tamil: "ta", Telugu: "te", Kannada: "kn", Bengali: "bn" };

const jsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function tagWithHaiku(language, lyrics) {
  const key = process.env.MA_ANTHROPIC_API_KEY;
  if (!key) return { genre: null, mood: [], theme: [] };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: TAG_MODEL, max_tokens: 200,
      messages: [{ role: "user", content: `Tag this ${language} song from its lyrics. Reply with JSON only: {"genre": <short slug like devotional, folk, light-classical, ballad, pop>, "mood": [up to 2 of ${MOODS.join("|")}], "theme": [up to 2 of ${THEMES.join("|")}, only if clearly present]}.\n\n${lyrics.slice(0, 800)}` }],
    }),
  });
  if (!res.ok) return { genre: null, mood: [], theme: [] };
  const text = (await res.json()).content?.[0]?.text ?? "";
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return { genre: null, mood: [], theme: [] }; }
}

async function post(file, meta) {
  if (dry) { console.log("DRY", meta.id, meta.language, meta.diction_u ?? "(server-scored)"); return; }
  const form = new FormData();
  form.set("file", new Blob([readFileSync(file)], { type: "audio/mpeg" }), `${meta.id}.mp3`);
  form.set("meta", JSON.stringify(meta));
  const res = await fetch(`${BASE}/api/admin/pool-ingest`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: form });
  const body = await res.json().catch(() => ({}));
  console.log(meta.id, res.status, body.status ?? body.error ?? "", body.unorderedPct ?? meta.diction_u ?? "");
}

if (!dry && (!BASE || !SECRET)) { console.error("set POOL_BASE_URL and the admin secret env"); process.exit(1); }

if (only !== "occasion") {
  const sets = [
    { prefix: "q60short", audio: "quality/audio-60s", scores: "quality/full-60s.jsonl", source: "eval_render" },
    { prefix: "q60full", audio: "quality/audio-60s-full", scores: "quality/full-60s-fulllyrics.jsonl", source: "eval_render" },
    { prefix: "review", audio: "quality/review-audio", scores: "quality/review-render.jsonl", source: "eval_render" },
  ];
  for (const s of sets) {
    for (const r of jsonl(`${DIR}/${s.scores}`)) {
      const file = `${DIR}/${s.audio}/${r.id}.mp3`;
      const language = LANG[r.language];
      if (!existsSync(file) || !language) continue;
      const tags = await tagWithHaiku(r.language, r.transcript);
      await post(file, {
        id: `${s.prefix}-${r.id}`, source: s.source, language, genre: tags.genre, mood: tags.mood, theme: tags.theme,
        diction_u: r.matchPct, diction_verdict: r.matchPct >= 80 ? "pass" : r.matchPct >= 60 ? "review" : "rerender",
      });
    }
  }
}
if (only !== "quality") {
  for (const o of JSON.parse(readFileSync(new URL("./pool-seed-occasion.json", import.meta.url), "utf8"))) {
    await post(`${DIR}/samples/occasion/${o.label}.mp3`, {
      id: `occ-${o.label}`, source: "new_render", language: o.language, title: o.title, genre: o.genre, mood: o.mood, theme: o.theme, lyrics: o.lyrics,
    });
  }
}
