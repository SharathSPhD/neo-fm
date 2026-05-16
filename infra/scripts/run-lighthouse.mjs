// Run Lighthouse against the four core unauthenticated pages and
// emit a markdown summary. Outputs both JSON (raw per-page report)
// and a single SUMMARY.md table for the v1.2 demo bundle.
//
// Authenticated pages (e.g. /library) are intentionally excluded:
// running Lighthouse with a logged-in cookie requires injecting a
// service-role-minted session token, which would make the demo
// bundle harder to reproduce. Public-surface coverage (`/`,
// `/discover`, `/pricing`, `/sign-in`) is what gates the Phase 6
// promise — these are the pages a new visitor hits first.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LH_BASE_URL ?? "https://neo-fm-web.vercel.app";
const OUT =
  process.env.LH_OUT_DIR ??
  "/home/sharaths/projects/neo-fm/demos/v1.2/sprint-7-lighthouse";
const CHROME =
  process.env.CHROME_BIN ??
  "/home/sharaths/.cache/ms-playwright/chromium-1223/chrome-linux/chrome";

const PAGES = [
  { label: "landing", path: "/" },
  { label: "discover", path: "/discover" },
  { label: "pricing", path: "/pricing" },
  { label: "sign-in", path: "/sign-in" },
];

fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const rows = [];

for (const p of PAGES) {
  const jsonOut = path.join(OUT, `${p.label}.json`);
  const url = `${BASE}${p.path}`;
  const args = [
    "--yes",
    "lighthouse@12",
    url,
    "--output=json",
    `--output-path=${jsonOut}`,
    "--quiet",
    "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu",
    "--only-categories=performance,accessibility,best-practices,seo",
    "--preset=desktop",
    "--max-wait-for-load=45000",
  ];
  console.log(`[lh] ${p.label} ← ${url}`);
  const env = { ...process.env, CHROME_PATH: CHROME };
  const res = spawnSync("npx", args, { stdio: "inherit", env });
  if (res.status !== 0) {
    rows.push({
      label: p.label,
      url,
      ok: false,
      error: `lighthouse exited ${res.status}`,
    });
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
  const cat = raw.categories;
  const fcp = raw.audits?.["first-contentful-paint"]?.numericValue ?? null;
  const lcp = raw.audits?.["largest-contentful-paint"]?.numericValue ?? null;
  const tbt = raw.audits?.["total-blocking-time"]?.numericValue ?? null;
  const cls = raw.audits?.["cumulative-layout-shift"]?.numericValue ?? null;
  const si = raw.audits?.["speed-index"]?.numericValue ?? null;
  rows.push({
    label: p.label,
    url,
    ok: true,
    perf: Math.round((cat.performance?.score ?? 0) * 100),
    a11y: Math.round((cat.accessibility?.score ?? 0) * 100),
    bp: Math.round((cat["best-practices"]?.score ?? 0) * 100),
    seo: Math.round((cat.seo?.score ?? 0) * 100),
    fcp_ms: fcp == null ? null : Math.round(fcp),
    lcp_ms: lcp == null ? null : Math.round(lcp),
    tbt_ms: tbt == null ? null : Math.round(tbt),
    cls: cls == null ? null : Number(cls.toFixed(3)),
    speed_index_ms: si == null ? null : Math.round(si),
  });
}

const took = ((Date.now() - t0) / 1000).toFixed(1);

const mdLines = [
  "# Sprint 7.5 — Lighthouse",
  "",
  `**Target**: ${BASE}`,
  `**Preset**: desktop, headless Chrome (Playwright bundle)`,
  `**Date**: ${new Date().toISOString()}`,
  `**Total runtime**: ${took}s`,
  "",
  "Authenticated pages (e.g. `/library`) are excluded — see comment in",
  "`infra/scripts/run-lighthouse.mjs`. Public-surface coverage is what",
  "gates the Phase 6 promise.",
  "",
  "## Scores",
  "",
  "| Page | Perf | A11y | BP | SEO | LCP (ms) | TBT (ms) | CLS |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];

for (const r of rows) {
  if (!r.ok) {
    mdLines.push(`| \`${r.label}\` | — | — | — | — | — | — | — |`);
    continue;
  }
  mdLines.push(
    `| \`${r.label}\` | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.lcp_ms ?? "—"} | ${r.tbt_ms ?? "—"} | ${r.cls ?? "—"} |`,
  );
}

mdLines.push("");
mdLines.push("## Raw reports");
mdLines.push("");
for (const r of rows) {
  mdLines.push(`- [\`${r.label}.json\`](./${r.label}.json)`);
}
mdLines.push("");
mdLines.push("## Re-run");
mdLines.push("");
mdLines.push("```bash");
mdLines.push("node infra/scripts/run-lighthouse.mjs");
mdLines.push("```");
mdLines.push("");

fs.writeFileSync(path.join(OUT, "SUMMARY.md"), mdLines.join("\n"));
fs.writeFileSync(
  path.join(OUT, "summary.json"),
  JSON.stringify({ base: BASE, finishedAt: new Date().toISOString(), rows }, null, 2),
);

const allOk = rows.every((r) => r.ok);
console.log(`\n[lh] wrote ${path.join(OUT, "SUMMARY.md")}`);
if (!allOk) {
  console.error("[lh] one or more pages failed to render");
  process.exit(1);
}
