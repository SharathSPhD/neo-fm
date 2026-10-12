/**
 * /api/admin/pce-eval -- offline PCE-vs-single-shot lyric evaluation (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 *   POST ?action=start&batch=<name>[&n=10]   queue briefs: single-shot arm is written now, PCE arm runs as a lyrics-only agent session
 *   GET  ?action=advance&batch=<name>        drive running sessions, fetch lyrics, run blind judges for finished pairs
 *   GET  ?action=report&batch=<name>         win/loss/tie counts + per-brief summary
 * No audio is rendered (no Lyria spend). Costs: one Haiku session + one Haiku call + 2 Sonnet judgements per brief.
 */
import { NextResponse, type NextRequest } from "next/server";

import { anthropicClient, serviceClient, sessionApi } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { mintEmbedToken } from "../../../../lib/agent/embed-token";
import { briefText } from "../../../../lib/agent/runner";
import { agentIdFor, requireId } from "../../../../lib/agent/tiers";
import { allEvalBriefs } from "../../../../lib/eval/briefs-gen";

const PILOT_BRIEFS = allEvalBriefs();
import { polishLyrics } from "../../../../lib/lyrics/polish";
import { bestOfSix, judgePair, singleShot, STRUCTURE_TARGET } from "../../../../lib/eval/judge";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

const LYRICS_ONLY = `\nEVALUATION RUN: ${STRUCTURE_TARGET} Lyrics only. Do NOT call generate_music. Run the pce-poem skill, write /mnt/session/outputs/lyrics.md and cascade_audit.json, then finish.`;

async function fetchLyrics(sessionId: string): Promise<string | null> {
  const client = anthropicClient();
  const files: { id: string; filename: string }[] = [];
  for await (const f of client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] })) files.push({ id: f.id, filename: f.filename });
  // Only count runs that actually executed the PCE engine (cascade_audit.json is its receipt).
  if (!files.some((x) => x.filename.endsWith("cascade_audit.json"))) return null;
  const f = files.find((x) => x.filename.endsWith("lyrics.md"));
  return f ? await (await client.beta.files.download(f.id)).text() : null;
}

export async function POST(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const batch = req.nextUrl.searchParams.get("batch");
  if (!batch) return NextResponse.json({ error: "batch required" }, { status: 400 });
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0));
  const n = Math.min(Number(req.nextUrl.searchParams.get("n") ?? 10), PILOT_BRIEFS.length - offset);
  const lang = req.nextUrl.searchParams.get("lang"); // optional language filter, e.g. Telugu
  const pool = lang ? PILOT_BRIEFS.filter((b) => b.language.toLowerCase() === lang.toLowerCase()) : PILOT_BRIEFS;
  const db = serviceClient(); const client = anthropicClient(); const sessions = sessionApi();
  const envId = requireId("MA_ENVIRONMENT_ID", process.env.MA_ENVIRONMENT_ID, "env_");
  const { data: cfg } = await db.from("config_versions").select("id").eq("kind", "pipeline").eq("status", "live").limit(1);
  const configId = ((cfg ?? [])[0] as { id: string } | undefined)?.id ?? null;
  const out: string[] = [];
  const baseline = req.nextUrl.searchParams.get("baseline") === "best6" ? "best6" : "single";
  const polish = req.nextUrl.searchParams.get("polish") === "1"; // apply the Sonnet meter/diction polish to reused PCE lyrics
  const reuse = req.nextUrl.searchParams.get("reuse"); // copy finished PCE arms from another batch (no re-run)
  for (const b of pool.slice(offset, offset + n)) {
    const base = { batch, brief_id: b.id, language: b.language, style_family: b.style, brief: b.text, config_version_id: configId };
    try {
      const text = baseline === "best6" ? await bestOfSix(client, b.language, b.style, b.text) : await singleShot(client, b.language, b.style, b.text);
      await db.from("eval_runs").upsert({ ...base, arm: "single", status: "done", lyrics: text }, { onConflict: "batch,brief_id,arm", ignoreDuplicates: true });
      if (reuse) {
        const { data: prev } = await db.from("eval_runs").select("lyrics,session_id").eq("batch", reuse).eq("brief_id", b.id).eq("arm", "pce").eq("status", "done").maybeSingle();
        if (prev?.lyrics) { await db.from("eval_runs").upsert({ ...base, arm: "pce", status: "done", lyrics: polish ? await polishLyrics(client, { language: b.language, style: b.style, brief: b.text, lyrics: prev.lyrics }) : prev.lyrics, session_id: prev.session_id }, { onConflict: "batch,brief_id,arm", ignoreDuplicates: true }); out.push(`${b.id}: reused`); continue; }
      }
      const s = await sessions.create({ agentId: agentIdFor("free"), environmentId: envId, title: `eval ${batch} ${b.id}` });
      const engine = process.env.EMBED_URL && process.env.EMBED_TOKEN ? { url: process.env.EMBED_URL.trim(), token: mintEmbedToken(process.env.EMBED_TOKEN.trim(), 3600) } : undefined;
      await sessions.sendOutcome(s.id, { description: briefText({ language: b.language, styleFamily: b.style, targetSeconds: 30, prompt: b.text, engine }) + LYRICS_ONLY, rubric: "- lyrics.md exists, in the target language and script, sectioned for singing", maxIterations: 1 });
      await db.from("eval_runs").upsert({ ...base, arm: "pce", status: "running", session_id: s.id }, { onConflict: "batch,brief_id,arm", ignoreDuplicates: true });
      out.push(`${b.id}: queued`);
    } catch (e) { out.push(`${b.id}: ${String((e as Error).message).slice(0, 120)}`); }
  }
  return NextResponse.json({ batch, out });
}

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const batch = req.nextUrl.searchParams.get("batch");
  const action = req.nextUrl.searchParams.get("action") ?? "report";
  if (!batch) return NextResponse.json({ error: "batch required" }, { status: 400 });
  const db = serviceClient(); const client = anthropicClient(); const sessions = sessionApi();

  if (action === "events") {
    const sid = req.nextUrl.searchParams.get("session");
    if (!sid) return NextResponse.json({ error: "session required" }, { status: 400 });
    const events = await sessions.listEvents(sid);
    const files: string[] = [];
    for await (const f of client.beta.files.list({ scope_id: sid, betas: ["managed-agents-2026-04-01"] })) files.push(f.filename);
    return NextResponse.json({ n: events.length, files, tail: events.slice(-12).map((e) => JSON.stringify(e).slice(0, 400)) });
  }

  if (action === "advance") {
    const { data: running } = await db.from("eval_runs").select("*").eq("batch", batch).eq("arm", "pce").eq("status", "running");
    const log: string[] = [];
    for (const r of (running ?? []) as { id: string; brief_id: string; session_id: string }[]) {
      try {
        const events = await sessions.listEvents(r.session_id);
        const confirmed = new Set(events.filter((e) => e.type === "user.tool_confirmation").map((e) => e.tool_use_id));
        for (const e of events.filter((x) => (x.type === "agent.tool_use" || x.type === "agent.mcp_tool_use") && x.evaluated_permission === "ask" && !confirmed.has(x.id))) {
          const ok = e.type === "agent.tool_use" && ["bash", "read", "write", "edit", "glob", "grep"].includes(String(e.name));
          await sessions.sendToolConfirmation(r.session_id, e.id, ok ? "allow" : "deny", ok ? undefined : "Not permitted for evaluation runs.");
        }
        // generate_music must never run in an eval: refuse any call.
        const answered = new Set(events.filter((e) => e.type === "user.custom_tool_result").map((e) => e.custom_tool_use_id));
        for (const e of events.filter((x) => x.type === "agent.custom_tool_use" && !answered.has(x.id))) await sessions.sendToolResult(r.session_id, e.id, "Refused: evaluation run, no audio.", true);
        const last = [...events].reverse().find((e) => e.type === "session.status_idle" || e.type === "session.status_terminated");
        const idle = last?.type === "session.status_idle" && last.stop_reason?.type !== "requires_action";
        if ((idle && (await sessions.status(r.session_id)) === "idle") || last?.type === "session.status_terminated") {
          const text = await fetchLyrics(r.session_id);
          await db.from("eval_runs").update(text ? { status: "done", lyrics: text } : { status: "failed", error: "no lyrics.md" }).eq("id", r.id);
          log.push(`${r.brief_id}: ${text ? "done" : "failed"}`);
        }
      } catch (e) { log.push(`${r.brief_id}: ${String((e as Error).message).slice(0, 100)}`); }
    }
    // Judge finished pairs.
    const { data: all } = await db.from("eval_runs").select("*").eq("batch", batch);
    const { data: judged } = await db.from("eval_judgments").select("brief_id").eq("batch", batch);
    const have = new Set(((judged ?? []) as { brief_id: string }[]).map((j) => j.brief_id));
    const rows = (all ?? []) as { brief_id: string; arm: string; status: string; lyrics: string | null; language: string; brief: string }[];
    let budget = 3; // keep each advance call well inside maxDuration
    for (const id of new Set(rows.map((r) => r.brief_id))) {
      if (have.has(id) || budget <= 0) continue;
      const pce = rows.find((r) => r.brief_id === id && r.arm === "pce"); const one = rows.find((r) => r.brief_id === id && r.arm === "single");
      if (pce?.status === "done" && pce.lyrics && one?.status === "done" && one.lyrics) {
        budget--;
        const j = await judgePair(client, pce.language, pce.brief, pce.lyrics, one.lyrics);
        await db.from("eval_judgments").upsert({ batch, brief_id: id, winner: j.winner, detail: j.detail }, { onConflict: "batch,brief_id" });
        log.push(`${id}: judged ${j.winner}`);
      }
    }
    return NextResponse.json({ batch, log });
  }

  const { data: j } = await db.from("eval_judgments").select("brief_id,winner,detail").eq("batch", batch);
  const { data: runs } = await db.from("eval_runs").select("brief_id,arm,status").eq("batch", batch);
  const judgments = (j ?? []) as { brief_id: string; winner: string }[];
  const count = (w: string) => judgments.filter((x) => x.winner === w).length;
  return NextResponse.json({
    batch, judged: judgments.length, pce_wins: count("pce"), single_wins: count("single"), ties: count("tie"),
    pending_runs: ((runs ?? []) as { status: string }[]).filter((r) => r.status === "running").length,
    per_brief: judgments,
  });
}
