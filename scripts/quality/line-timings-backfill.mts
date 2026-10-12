/**
 * Read-only backfill planner for line timings. Never writes to the database or storage.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/quality/line-timings-backfill.mts            # dry run: counts + sample
 *   ... GEMINI_API_KEY=... npx tsx scripts/quality/line-timings-backfill.mts --compute --limit 5 --out timings.json  # computes payloads locally
 *
 * Candidates: agent_runs rows with audio_path and lyrics. Before migration 0076 exists the `line_timings` filter is skipped
 * (the column is selected only with --has-column). Untested against prod from this thread (no service credentials here).
 */
import { writeFileSync } from "node:fs";

import { alignLines, toPayload, transcribeTimed } from "../../apps/web/lib/diction/timestamps";
import { singable } from "./diction-sweep";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (read-only use)"); process.exit(1); }
const h = { apikey: key, authorization: `Bearer ${key}` };
const limit = Number(arg("limit") ?? "20");
const hasCol = flag("has-column");

const cols = `job_id,audio_path,lyrics${hasCol ? ",line_timings" : ""}`;
const q = `${url}/rest/v1/agent_runs?select=${cols}&audio_path=not.is.null&lyrics=not.is.null${hasCol ? "&line_timings=is.null" : ""}&order=created_at.desc&limit=${limit}`;
const rows = (await (await fetch(q, { headers: h })).json()) as { job_id: string; audio_path: string; lyrics: string }[];
console.log(`${rows.length} candidate songs (limit ${limit}); ~${rows.length} Gemini audio calls to compute.`);
if (!flag("compute")) { console.log(rows.slice(0, 5).map((r) => `${r.job_id} ${r.audio_path}`).join("\n")); process.exit(0); }

const gem = process.env.GEMINI_API_KEY;
if (!gem) { console.error("GEMINI_API_KEY required for --compute"); process.exit(1); }
const out: Record<string, unknown> = {};
for (const r of rows) {
  try {
    const dl = await fetch(`${url}/storage/v1/object/tracks/${r.audio_path}`, { headers: h });
    if (!dl.ok) { out[r.job_id] = { error: `audio ${dl.status}` }; continue; }
    const audio = new Uint8Array(await dl.arrayBuffer());
    const lines = singable(r.lyrics).split("\n");
    let segs = await transcribeTimed(audio, dl.headers.get("content-type") ?? "audio/mpeg", "the song's", gem);
    if (!segs.length) segs = await transcribeTimed(audio, "audio/mpeg", "the song's", gem);
    const last = segs.length ? Math.max(...segs.map((s) => s.startS)) : 0;
    const dur = Number(arg("duration") ?? Math.ceil(last + 6));
    out[r.job_id] = toPayload(alignLines(lines, segs, dur), dur);
  } catch (e) { out[r.job_id] = { error: String((e as Error).message).slice(0, 160) }; }
}
writeFileSync(arg("out") ?? "line-timings-dryrun.json", JSON.stringify(out, null, 1));
console.log(`wrote ${Object.keys(out).length} payloads locally; nothing written to the database.`);
