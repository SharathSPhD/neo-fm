#!/usr/bin/env node
/**
 * READ-ONLY audio integrity check for the private `tracks` bucket. Never writes, deletes or signs anything.
 *
 * Finds three kinds of problem:
 *   missing  - a live track row (or a completed job's agent_runs.audio_path) whose object is not in the bucket: the song plays nothing.
 *   orphan   - an object in the bucket that no track row or agent run points at: wasted storage / leaked spend.
 *   no_track - a completed job with no track row at all.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-audio-integrity.mjs [--json] [--days=30]
 *
 * Exit code 0 = clean, 1 = findings, 2 = could not run. `--days` limits the missing/no_track check to recent jobs
 * (orphans are always checked over the whole bucket).
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "tracks";

/** Track urls are stored as `tracks/<jobId>/<n>.mp3`; the object path inside the bucket drops the prefix. */
export function objectPath(url) {
  return String(url ?? "").replace(/^tracks\//, "");
}

/**
 * Pure comparison, unit tested.
 * @param {{ tracks: {id:string, job_id:string, url:string, deleted_at?:string|null}[],
 *           completedJobs: string[],
 *           runs: {job_id:string, audio_path:string|null}[],
 *           objects: string[] }} input
 */
export function diffAudio({ tracks, completedJobs, runs, objects }) {
  const have = new Set(objects);
  const referenced = new Set();
  const missing = [];
  for (const t of tracks) {
    const p = objectPath(t.url);
    referenced.add(p);
    if (!t.deleted_at && !have.has(p)) missing.push({ job_id: t.job_id, track_id: t.id, path: p, source: "tracks.url" });
  }
  const completed = new Set(completedJobs);
  for (const r of runs) {
    if (!r.audio_path) continue;
    referenced.add(r.audio_path);
    if (completed.has(r.job_id) && !have.has(r.audio_path) && !missing.some((m) => m.path === r.audio_path)) {
      missing.push({ job_id: r.job_id, track_id: null, path: r.audio_path, source: "agent_runs.audio_path" });
    }
  }
  const orphans = objects.filter((o) => !referenced.has(o));
  const withTrack = new Set(tracks.map((t) => t.job_id));
  const noTrack = completedJobs.filter((j) => !withTrack.has(j));
  return { missing, orphans, no_track: noTrack };
}

async function listAllObjects(db) {
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: folders, error } = await db.storage.from(BUCKET).list("", { limit: 1000, offset });
    if (error) throw new Error(`storage list: ${error.message}`);
    for (const f of folders) {
      if (f.id) { objects.push(f.name); continue; } // a file at the bucket root
      const { data: files, error: e2 } = await db.storage.from(BUCKET).list(f.name, { limit: 1000 });
      if (e2) throw new Error(`storage list ${f.name}: ${e2.message}`);
      for (const o of files) if (o.id) objects.push(`${f.name}/${o.name}`);
    }
    if (folders.length < 1000) break;
  }
  return objects;
}

async function fetchAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const days = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 30);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [objects, tracks, jobs, runs] = await Promise.all([
    listAllObjects(db),
    fetchAll(() => db.from("tracks").select("id,job_id,url,deleted_at").order("id")),
    fetchAll(() => db.from("jobs").select("id").eq("status", "completed").gte("finished_at", since).order("id")),
    fetchAll(() => db.from("agent_runs").select("job_id,audio_path").not("audio_path", "is", null).order("job_id")),
  ]);
  const completedJobs = jobs.map((j) => j.id);
  const recentTracks = tracks; // orphans need every row; missing is naturally limited by what exists
  const res = diffAudio({ tracks: recentTracks, completedJobs, runs, objects });
  const summary = { project: new URL(url).hostname.split(".")[0], objects: objects.length, tracks: tracks.length, completed_in_window: completedJobs.length, missing: res.missing.length, orphans: res.orphans.length, no_track: res.no_track.length };
  if (json) console.log(JSON.stringify({ summary, ...res }, null, 2));
  else {
    console.log(`audio integrity (${summary.project}): ${JSON.stringify(summary)}`);
    for (const m of res.missing) console.log(`MISSING  job=${m.job_id} ${m.path} (${m.source})`);
    for (const o of res.orphans) console.log(`ORPHAN   ${o}`);
    for (const j of res.no_track) console.log(`NO_TRACK job=${j}`);
    if (!res.missing.length && !res.orphans.length && !res.no_track.length) console.log("clean");
  }
  process.exit(res.missing.length || res.orphans.length || res.no_track.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(2); });
