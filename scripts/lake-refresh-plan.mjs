#!/usr/bin/env node
/**
 * Weekly lake refresh planner (strategy/station-pass-and-lake.md). Reads the read-only curation report
 * (GET /api/admin/lake-curation) and proposes, per language, which tracks to replace and which genre x energy cells to add to,
 * then writes ready briefs files and the exact scripts/lake-fill.mjs command with a cost estimate. It spends nothing and
 * changes nothing: a fill is one tap card on the printed command.
 *
 *   POOL_BASE_URL=https://<prod> node scripts/lake-refresh-plan.mjs --out dir [--lang kn,hi] [--target kn=100,hi=100] [--max-per-lang 30]
 *   node scripts/lake-refresh-plan.mjs --report curation.json --out dir     (offline, from a saved report)
 *
 * Replacement = verdict "replace" in the report (reported, skipped, too short, or two weak signals). Retiring those rows is left
 * to the operator after the replacements are admitted, so the lake never shrinks mid-week.
 * Mood and daypart gaps are not in the report yet (it carries genre and energy only); briefs rotate them to spread coverage.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RENDER_GBP = 0.25;
export const CLAUDE_GBP = 0.03;
/** Recent admit rate (hi 89 of 98, te 56 of 68); renders needed = tracks wanted / this. */
export const ADMIT_RATE = 0.88;
export const ENERGIES = ["low", "mid", "high"];
export const NAMES = { kn: "Kannada", hi: "Hindi", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", pa: "Punjabi", gu: "Gujarati", ml: "Malayalam", en: "English" };
const MOODS = { low: ["calm", "tender", "nostalgic"], mid: ["warm", "hopeful", "romantic"], high: ["joyful", "playful", "festive"] };
const DAYPARTS = ["morning", "midday", "evening", "night", "dawn", "dusk"];
const THEMES = ["friendship", "monsoon", "home", "travel", "first love", "festival", "mother", "city lights", "harvest", "college days", "a long train ride", "temple morning", "rain on the roof", "old friends", "a new start"];

export function fillCost(wanted) {
  const renders = Math.ceil(wanted / ADMIT_RATE);
  return { renders, gbp: Math.round((renders * (RENDER_GBP + CLAUDE_GBP)) * 100) / 100, maxGbp: Math.ceil(renders * RENDER_GBP * 1.1) };
}

/** Genre x energy cells for one language: every genre already in the pool at every energy, thinnest first. Missing cells count 0. */
export function gridCells(lang) {
  const counts = new Map();
  for (const c of lang.cells ?? []) counts.set(`${c.genre}|${c.energy}`, c.tracks);
  const genres = [...new Set((lang.cells ?? []).map((c) => c.genre).filter((g) => g !== "untagged"))];
  const out = [];
  for (const genre of genres) for (const energy of ENERGIES) out.push({ genre, energy, tracks: counts.get(`${genre}|${energy}`) ?? 0 });
  return out.sort((a, b) => a.tracks - b.tracks || a.genre.localeCompare(b.genre) || ENERGIES.indexOf(a.energy) - ENERGIES.indexOf(b.energy));
}

/** Spread `n` new briefs over the thinnest cells, always topping up the currently thinnest one. */
export function pickCells(cells, n) {
  const cur = cells.map((c) => ({ ...c }));
  const picked = [];
  for (let i = 0; i < n && cur.length; i++) {
    cur.sort((a, b) => a.tracks - b.tracks);
    cur[0].tracks += 1;
    picked.push({ genre: cur[0].genre, energy: cur[0].energy });
  }
  return picked;
}

export function makeBriefs(code, cells, stamp) {
  const language = NAMES[code] ?? code;
  return cells.map((c, i) => {
    const mood = MOODS[c.energy][i % 3];
    const theme = THEMES[(i * 4 + code.charCodeAt(0)) % THEMES.length];
    return {
      id: `r${stamp}-${i + 1}`,
      language,
      code,
      style: c.genre,
      text: `A ${mood} ${c.genre} song in ${language} about ${theme}`,
      title: `${language} ${c.genre} ${i + 1}`,
      genre: c.genre,
      mood: [mood],
      theme: [theme],
      energy: c.energy,
      daypart: [DAYPARTS[i % DAYPARTS.length]],
    };
  });
}

/** report = the lake-curation response; targets = { kn: 100 }; returns one plan entry per language in the report. */
export function planRefresh(report, { targets = {}, maxPerLang = 30, stamp = "0" } = {}) {
  const plans = [];
  for (const [code, lang] of Object.entries(report.languages ?? {})) {
    const replace = lang.tracks.filter((t) => t.verdict === "replace").map((t) => ({ id: t.id, title: t.title, flags: t.flags, score: t.score }));
    const watch = lang.tracks.filter((t) => t.verdict === "watch").length;
    const target = targets[code] ?? lang.total;
    const deficit = Math.max(0, target - (lang.total - replace.length));
    const wanted = Math.min(maxPerLang, deficit);
    const cells = pickCells(gridCells(lang), wanted);
    plans.push({
      code,
      total: lang.total,
      target,
      replace,
      watch,
      add: wanted,
      capped: deficit > wanted,
      thinnest: gridCells(lang).slice(0, 4),
      briefs: makeBriefs(code, cells, stamp),
      cost: wanted > 0 ? fillCost(wanted) : null,
    });
  }
  return plans;
}

export function fillCommand(plan, briefsPath, outDir) {
  return `POOL_BASE_URL=https://neo-fm-web.vercel.app node scripts/lake-fill.mjs --briefs ${briefsPath} --out ${outDir}/fill-${plan.code} --max-gbp ${plan.cost.maxGbp}`;
}

export function renderMarkdown(plans, files) {
  const lines = ["# Lake refresh plan", "", "| Lang | In lake | Replace | Watch | Add | Est. cost | Thinnest cells |", "|---|---|---|---|---|---|---|"];
  for (const p of plans) {
    const thin = p.thinnest.map((c) => `${c.genre}/${c.energy} (${c.tracks})`).join(", ") || "-";
    lines.push(`| ${p.code} | ${p.total} | ${p.replace.length} | ${p.watch} | ${p.add}${p.capped ? " (capped)" : ""} | ${p.cost ? `£${p.cost.gbp}` : "-"} | ${thin} |`);
  }
  const total = plans.reduce((n, p) => n + (p.cost?.gbp ?? 0), 0);
  lines.push("", `Total estimate £${total.toFixed(2)} (renders at £${RENDER_GBP} / admit rate ${ADMIT_RATE}, plus about £${CLAUDE_GBP} Claude per render).`, "");
  for (const p of plans.filter((x) => x.cost)) lines.push(`### ${p.code}`, "```", fillCommand(p, files[p.code], files.dir), "```", `Retire after admission: ${p.replace.map((r) => r.id).join(", ") || "none"}`, "");
  return lines.join("\n");
}

async function main() {
  const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
  const out = arg("--out", "lake-refresh");
  let report;
  if (arg("--report")) report = JSON.parse(readFileSync(arg("--report"), "utf8"));
  else {
    const base = (process.env.POOL_BASE_URL ?? "").replace(/\/$/, "");
    const secret = process.env[process.env.ADMIN_SECRET_ENV ?? "MA_PROD_ADMIN_SECRET"];
    if (!base || !secret) { console.error("set POOL_BASE_URL and the admin secret env, or pass --report"); process.exit(1); }
    const res = await fetch(`${base}/api/admin/lake-curation?lang=${arg("--lang", "kn,hi")}`, { headers: { authorization: `Bearer ${secret}` } });
    if (!res.ok) { console.error(`lake-curation ${res.status}`); process.exit(1); }
    report = await res.json();
  }
  const targets = Object.fromEntries((arg("--target", "") || "").split(",").filter(Boolean).map((p) => { const [k, v] = p.split("="); return [k, Number(v)]; }));
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const plans = planRefresh(report, { targets, maxPerLang: Number(arg("--max-per-lang", "30")), stamp });
  mkdirSync(out, { recursive: true });
  const files = { dir: out };
  for (const p of plans.filter((x) => x.add > 0)) {
    files[p.code] = `${out}/briefs-${p.code}.json`;
    writeFileSync(files[p.code], JSON.stringify(p.briefs, null, 1));
  }
  writeFileSync(`${out}/plan.json`, JSON.stringify(plans.map(({ briefs, ...rest }) => rest), null, 1));
  const md = renderMarkdown(plans, files);
  writeFileSync(`${out}/plan.md`, md);
  console.log(md);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
