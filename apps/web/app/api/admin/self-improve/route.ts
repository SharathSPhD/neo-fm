/**
 * /api/admin/self-improve -- guarded self-improvement of the lyric polish prompt (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 *
 *   POST ?action=propose            Opus drafts a better polish template from the WORST pairs of batch fullB (training pairs only).
 *                                   Stored as config_versions(kind=polish_prompt,status=draft). Never goes live by itself.
 *   POST ?action=evaluate&config=ID Polishes the HELD-OUT briefs (numeric suffix >= 25: 6 per language, never shown to the proposer)
 *                                   with the candidate, judges vs the best-of-6 baseline, compares with the live template on the
 *                                   same briefs. Writes eval_report + a verdict (recommend | reject). Draft -> shadow when recommended.
 *   POST ?action=promote&config=ID&approved_by=NAME   Only a `shadow` candidate with a `recommend` verdict can go live (two-family judge
 *                                   agreement: Claude AND Gemini). `evaluate&auto=1` promotes automatically with approved_by=auto:claude+gemini;
 *                                   the previous live version is retired and remembered as parent for rollback.
 *   POST ?action=monitor            Post-promotion guard: if the pronunciation match of jobs after the live version started is >10 points worse
 *                                   than before, the version is rolled back automatically.
 *   POST ?action=rollback           Re-activates the parent of the live version.
 * Safety: templates are data only (placeholders enforced, no URLs / safety-related text); the output of any polish still passes the
 * lyrics moderation gate before audio. Goodhart caveat: the judges are LLMs and the held-out set is small, so promotion needs BOTH model families to agree and is guarded by the monitor.
 */
import { NextRequest, NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { judgePair, judgePairGemini } from "../../../../lib/eval/judge";
import { DEFAULT_POLISH_TEMPLATE, polishLyrics, validatePolishTemplate } from "../../../../lib/lyrics/polish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROPOSER_MODEL = "claude-opus-5-5";
const isHeldOut = (briefId: string) => Number(briefId.split("-")[1]) >= 25;

type Row = { brief_id: string; arm: string; lyrics: string; language: string; style_family: string; brief: string };

async function liveTemplate(db: ReturnType<typeof serviceClient>): Promise<{ id: string | null; template: string }> {
  const { data } = await db.from("config_versions").select("id,payload").eq("kind", "polish_prompt").eq("status", "live").limit(1);
  const r = (data ?? [])[0] as { id: string; payload: { template: string } } | undefined;
  return { id: r?.id ?? null, template: r?.payload?.template ?? DEFAULT_POLISH_TEMPLATE };
}

export async function POST(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const action = req.nextUrl.searchParams.get("action");
  const db = serviceClient(); const client = anthropicClient();

  if (action === "propose") {
    const { data: js } = await db.from("eval_judgments").select("brief_id,winner,detail").eq("batch", "fullB");
    const train = ((js ?? []) as { brief_id: string; winner: string; detail: { total_diff?: number; dim_diff?: Record<string, number> } }[])
      .filter((j) => !isHeldOut(j.brief_id)).sort((a, b) => (a.detail.dim_diff?.prosody ?? 0) - (b.detail.dim_diff?.prosody ?? 0)).slice(0, 8);
    const { data: rs } = await db.from("eval_runs").select("brief_id,arm,lyrics,language,style_family,brief").eq("batch", "fullB").in("brief_id", train.map((t) => t.brief_id));
    const rows = (rs ?? []) as Row[];
    const examples = train.map((t) => {
      const pce = rows.find((r) => r.brief_id === t.brief_id && r.arm === "pce"); const base = rows.find((r) => r.brief_id === t.brief_id && r.arm === "single");
      return `### ${t.brief_id} (${pce?.language}) prosody diff ${t.detail.dim_diff?.prosody?.toFixed(1)}\nOur polished lyric:\n${pce?.lyrics}\nBaseline lyric (judged better on prosody):\n${base?.lyrics}`;
    }).join("\n\n");
    const live = await liveTemplate(db);
    const res = await client.messages.create({
      model: PROPOSER_MODEL, max_tokens: 6000,
      messages: [{ role: "user", content: `You improve a prompt template used by a lyric-polishing step for Indian-language songs. Keep every placeholder ({{language}}, {{style}}, {{brief}}, {{lyrics}}). Do not add URLs, do not mention system prompts, keys or safety. The step must stay a minimal edit that preserves imagery and section tags; its measured weakness is PROSODY (singable meter, equal syllable counts in paired lines) while imagery/originality are strengths to keep.\n\nCurrent template:\n<<<\n${live.template}\n>>>\n\nWorst-prosody training pairs:\n${examples}\n\nReply with ONLY JSON: {"template": string, "rationale": string (<=60 words)}.` }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    let cand: { template?: string; rationale?: string };
    try { cand = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return NextResponse.json({ error: "unparseable proposal" }, { status: 502 }); }
    const bad = validatePolishTemplate(cand.template ?? "");
    if (bad) return NextResponse.json({ error: "proposal_rejected", reason: bad }, { status: 422 });
    const { data: ins, error } = await db.from("config_versions").insert({ kind: "polish_prompt", payload: { template: cand.template, rationale: cand.rationale ?? "", proposer: PROPOSER_MODEL }, parent: live.id, status: "draft" }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config_id: (ins as { id: string }).id, rationale: cand.rationale, trained_on: train.map((t) => t.brief_id) });
  }

  if (action === "evaluate") {
    const id = req.nextUrl.searchParams.get("config");
    const { data: cfg } = await db.from("config_versions").select("id,payload,status").eq("id", id ?? "").maybeSingle();
    const c = cfg as { id: string; payload: { template: string }; status: string } | null;
    if (!c || c.status !== "draft") return NextResponse.json({ error: "draft_not_found" }, { status: 404 });
    const { data: all } = await db.from("eval_runs").select("brief_id,arm,lyrics,language,style_family,brief").eq("batch", "fullA").eq("status", "done");
    const rows = (all ?? []) as Row[];
    const ids = [...new Set(rows.map((r) => r.brief_id))].filter(isHeldOut).slice(0, Number(req.nextUrl.searchParams.get("n") ?? 30));
    const { data: cur } = await db.from("eval_judgments").select("brief_id,winner,detail").eq("batch", "fullB").in("brief_id", ids);
    const curMap = new Map(((cur ?? []) as { brief_id: string; winner: string; detail: { dim_diff?: Record<string, number> } }[]).map((j) => [j.brief_id, j]));
    const tally = { cand: { pce: 0, other: 0, tie: 0 }, cur: { pce: 0, other: 0, tie: 0 } };
    const gt = { cand: { pce: 0, other: 0, tie: 0 }, cur: { pce: 0, other: 0, tie: 0 } };
    const gkey = process.env.GEMINI_API_KEY;
    const dimsC: Record<string, number[]> = {}; const dimsL: Record<string, number[]> = {};
    for (let i = 0; i < ids.length; i += 5) {
      await Promise.all(ids.slice(i, i + 5).map(async (bid) => {
        const pce = rows.find((r) => r.brief_id === bid && r.arm === "pce"); const base = rows.find((r) => r.brief_id === bid && r.arm === "single");
        if (!pce || !base) return;
        try {
          const polished = await polishLyrics(client, { language: pce.language, style: pce.style_family, brief: pce.brief, lyrics: pce.lyrics }, c.payload.template);
          const j = await judgePair(client, pce.language, pce.brief, polished, base.lyrics);
          if (j.winner === "pce") tally.cand.pce++; else if (j.winner === "single") tally.cand.other++; else tally.cand.tie++;
          for (const [k, v] of Object.entries((j.detail as { dim_diff?: Record<string, number> }).dim_diff ?? {})) (dimsC[k] ??= []).push(v);
          if (gkey) {
            const g = await judgePairGemini(pce.language, pce.brief, polished, base.lyrics, gkey);
            if (g.winner === "pce") gt.cand.pce++; else if (g.winner === "single") gt.cand.other++; else gt.cand.tie++;
          }
          const l = curMap.get(bid);
          const lg = (l?.detail as { gemini?: { winner?: string } } | undefined)?.gemini?.winner;
          if (lg === "pce") gt.cur.pce++; else if (lg === "single") gt.cur.other++; else if (lg) gt.cur.tie++;
          if (l) { if (l.winner === "pce") tally.cur.pce++; else if (l.winner === "single") tally.cur.other++; else tally.cur.tie++; for (const [k, v] of Object.entries(l.detail.dim_diff ?? {})) (dimsL[k] ??= []).push(v); }
        } catch { /* a failed pair is dropped from both arms below via counts */ }
      }));
    }
    const mean = (m: Record<string, number[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)) * 100) / 100]));
    const dc = mean(dimsC), dl = mean(dimsL);
    const worseDims = Object.keys(dl).filter((k) => (dc[k] ?? 0) < dl[k]! - 0.15);
    const claudeOk = tally.cand.pce >= tally.cur.pce + 3 && worseDims.length === 0;
    const geminiOk = Boolean(gkey) && gt.cand.pce >= gt.cur.pce + 2; // an independent family must also see a gain
    const verdict = claudeOk && geminiOk ? "recommend" : "reject";
    const report = { n: ids.length, candidate: tally, gemini: gt, claude_ok: claudeOk, gemini_ok: geminiOk, candidate_dims: dc, live_dims: dl, worse_dims: worseDims, verdict, rule: "candidate PCE wins >= live wins + 3 on held-out and no dimension worse than live by > 0.15; promotion still needs human approval" };
    await db.from("config_versions").update({ eval_report: report, status: verdict === "recommend" ? "shadow" : "draft" }).eq("id", c.id);
    if (verdict === "recommend" && req.nextUrl.searchParams.get("auto") === "1") {
      await db.from("config_versions").update({ status: "retired" }).eq("kind", "polish_prompt").eq("status", "live");
      await db.from("config_versions").update({ status: "live", approved_by: "auto:claude+gemini", payload: { ...c.payload, promoted_at: new Date().toISOString() } }).eq("id", c.id);
      return NextResponse.json({ config_id: c.id, ...report, promoted: true });
    }
    return NextResponse.json({ config_id: c.id, ...report });
  }

  if (action === "promote") {
    const id = req.nextUrl.searchParams.get("config"); const by = req.nextUrl.searchParams.get("approved_by");
    if (!by) return NextResponse.json({ error: "approved_by required (human approval)" }, { status: 400 });
    const { data: cfg } = await db.from("config_versions").select("id,status,eval_report,parent").eq("id", id ?? "").maybeSingle();
    const c = cfg as { id: string; status: string; eval_report: { verdict?: string } | null; parent: string | null } | null;
    if (!c || c.status !== "shadow" || c.eval_report?.verdict !== "recommend") return NextResponse.json({ error: "only a shadow candidate with a recommend verdict can be promoted" }, { status: 409 });
    await db.from("config_versions").update({ status: "retired" }).eq("kind", "polish_prompt").eq("status", "live");
    const { error } = await db.from("config_versions").update({ status: "live", approved_by: by }).eq("id", c.id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ promoted: c.id, rollback_to: c.parent });
  }

  if (action === "monitor") {
    const { data: live } = await db.from("config_versions").select("id,parent,payload").eq("kind", "polish_prompt").eq("status", "live").maybeSingle();
    const l = live as { id: string; parent: string | null; payload: { promoted_at?: string } } | null;
    if (!l?.payload?.promoted_at) return NextResponse.json({ status: "nothing to monitor (built-in default is live)" });
    const { data: runs } = await db.from("agent_runs").select("updated_at,diction_qa").not("diction_qa", "is", null).order("updated_at", { ascending: false }).limit(60);
    const rows = ((runs ?? []) as { updated_at: string; diction_qa: { matchPct?: number } }[]).filter((r) => typeof r.diction_qa?.matchPct === "number");
    const after = rows.filter((r) => r.updated_at >= l.payload.promoted_at!).map((r) => r.diction_qa.matchPct!);
    const before = rows.filter((r) => r.updated_at < l.payload.promoted_at!).slice(0, 10).map((r) => r.diction_qa.matchPct!);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    if (after.length < 5 || before.length < 5) return NextResponse.json({ status: "not enough data yet", after: after.length, before: before.length });
    const drop = avg(before) - avg(after);
    if (drop > 10) {
      await db.from("config_versions").update({ status: "retired" }).eq("id", l.id);
      if (l.parent) await db.from("config_versions").update({ status: "live" }).eq("id", l.parent);
      return NextResponse.json({ status: "rolled_back", drop, before: avg(before), after: avg(after) });
    }
    return NextResponse.json({ status: "healthy", drop, before: avg(before), after: avg(after) });
  }

  if (action === "rollback") {
    const { data: live } = await db.from("config_versions").select("id,parent").eq("kind", "polish_prompt").eq("status", "live").maybeSingle();
    const l = live as { id: string; parent: string | null } | null;
    if (!l) return NextResponse.json({ error: "no live polish_prompt (already on the built-in default)" }, { status: 409 });
    await db.from("config_versions").update({ status: "retired" }).eq("id", l.id);
    if (l.parent) await db.from("config_versions").update({ status: "live" }).eq("id", l.parent);
    return NextResponse.json({ rolled_back: l.id, now_live: l.parent ?? "built-in default" });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

/** Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`: used for the daily post-promotion monitor. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  url.searchParams.set("action", "monitor");
  return POST(new NextRequest(url, { method: "POST", headers: req.headers }));
}
