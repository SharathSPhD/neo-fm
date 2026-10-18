/**
 * /api/admin/self-improve -- guarded self-improvement of the lyric polish prompt (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 *
 *   POST ?action=propose            Opus drafts a better polish template from the WORST pairs of batch fullB (training pairs only).
 *                                   Stored as config_versions(kind=polish_prompt,status=draft). Never goes live by itself.
 *   POST ?action=evaluate&config=ID Polishes the HELD-OUT briefs (numeric suffix >= 25: 6 per language, never shown to the proposer)
 *                                   with the candidate, judges vs the best-of-6 baseline, compares with the live template on the
 *                                   same briefs. Writes eval_report + a verdict (recommend | reject). Draft -> shadow when recommended.
 *   POST ?action=register          Body {template}: store a hand-written template (e.g. the FIT THE CLIP candidate) as a draft.
 *   POST ?action=estimate&config=ID[&set=held|occasion|both&n=12]   Dry run: case count and expected Claude USD. Spends nothing.
 *   evaluate takes the same params plus max_usd (default 2, cap 8): it refuses when the estimate exceeds it and stops when metered spend does.
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
import { checkCronOrAdminBearer } from "../../../../lib/agent/auth";
import { estimateGate, meter } from "../../../../lib/eval/cost";
import { judgePair, judgePairGemini } from "../../../../lib/eval/judge";
import { OCCASION_BATCH_SOURCE } from "../../../../lib/eval/occasion-briefs";
import { runPolishGate, type GateCase, type GateDeps, type PairJudgment, type Winner } from "../../../../lib/eval/polish-gate";
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
  const auth = checkCronOrAdminBearer(req.headers.get("authorization"));
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
    meter.record(PROPOSER_MODEL, res.usage);
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    let cand: { template?: string; rationale?: string };
    try { cand = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return NextResponse.json({ error: "unparseable proposal" }, { status: 502 }); }
    const bad = validatePolishTemplate(cand.template ?? "");
    if (bad) return NextResponse.json({ error: "proposal_rejected", reason: bad }, { status: 422 });
    const { data: ins, error } = await db.from("config_versions").insert({ kind: "polish_prompt", payload: { template: cand.template, rationale: cand.rationale ?? "", proposer: PROPOSER_MODEL }, parent: live.id, status: "draft" }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config_id: (ins as { id: string }).id, rationale: cand.rationale, trained_on: train.map((t) => t.brief_id) });
  }

  if (action === "register") {
    // Put a hand-written template (for example managed-agents/candidates/polish-tail-safe.md) into the gate as a draft.
    // POST body: {"template": string, "rationale"?: string}. It never goes live without evaluate + promote.
    const body = (await req.json().catch(() => ({}))) as { template?: string; rationale?: string };
    const bad = validatePolishTemplate(body.template ?? "");
    if (bad) return NextResponse.json({ error: "template_rejected", reason: bad }, { status: 422 });
    const live = await liveTemplate(db);
    const { data: ins, error } = await db.from("config_versions").insert({ kind: "polish_prompt", payload: { template: body.template, rationale: body.rationale ?? "", proposer: "manual" }, parent: live.id, status: "draft" }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config_id: (ins as { id: string }).id });
  }

  if (action === "estimate" || action === "evaluate") {
    meter.reset();
    const id = req.nextUrl.searchParams.get("config");
    const { data: cfg } = await db.from("config_versions").select("id,payload,status").eq("id", id ?? "").maybeSingle();
    const c = cfg as { id: string; payload: { template: string }; status: string } | null;
    if (!c || c.status !== "draft") return NextResponse.json({ error: "draft_not_found" }, { status: 404 });
    const set = req.nextUrl.searchParams.get("set") ?? "held"; // held | occasion | both
    const n = Math.max(1, Math.min(60, Number(req.nextUrl.searchParams.get("n") ?? 12)));
    const maxUsd = Math.min(Number(req.nextUrl.searchParams.get("max_usd") ?? process.env.EVAL_MAX_USD ?? 2), 8);
    const gkey = process.env.GEMINI_API_KEY;

    const cases: GateCase[] = [];
    if (set === "held" || set === "both") {
      const { data: all } = await db.from("eval_runs").select("brief_id,arm,lyrics,language,style_family,brief").eq("batch", "fullA").eq("status", "done");
      const rows = (all ?? []) as Row[];
      const ids = [...new Set(rows.map((r) => r.brief_id))].filter(isHeldOut).sort().slice(0, n);
      const { data: cur } = await db.from("eval_judgments").select("brief_id,winner,detail").eq("batch", "fullB").in("brief_id", ids);
      const curMap = new Map(((cur ?? []) as { brief_id: string; winner: Winner; detail: PairJudgment["detail"] & { gemini?: { winner?: Winner } } }[]).map((j) => [j.brief_id, j]));
      for (const bid of ids) {
        const pce = rows.find((r) => r.brief_id === bid && r.arm === "pce"); const base = rows.find((r) => r.brief_id === bid && r.arm === "single");
        if (!pce || !base) continue;
        const l = curMap.get(bid);
        cases.push({ set: "held", id: bid, language: pce.language, style: pce.style_family, brief: pce.brief, draft: pce.lyrics, baseline: base.lyrics, stored: l ? { claude: { winner: l.winner, detail: l.detail }, gemini: l.detail?.gemini?.winner } : undefined });
      }
    }
    if (set === "occasion" || set === "both") {
      const { data: all } = await db.from("eval_runs").select("brief_id,arm,lyrics,language,style_family,brief").eq("batch", OCCASION_BATCH_SOURCE).eq("status", "done");
      const rows = (all ?? []) as Row[];
      for (const bid of [...new Set(rows.map((r) => r.brief_id))].sort().slice(0, n)) {
        const pce = rows.find((r) => r.brief_id === bid && r.arm === "pce"); const base = rows.find((r) => r.brief_id === bid && r.arm === "single");
        if (pce && base) cases.push({ set: "occasion", id: bid, language: pce.language, style: pce.style_family, brief: pce.brief, draft: pce.lyrics, baseline: base.lyrics });
      }
      if (!cases.some((x) => x.set === "occasion")) return NextResponse.json({ error: "no occasion drafts: run pce-eval POST ?action=start&batch=occA&set=occasion, then advance, first" }, { status: 409 });
    }
    const est = estimateGate({ briefs: cases.length, liveRecompute: cases.filter((x) => !x.stored).length });
    if (action === "estimate") return NextResponse.json({ config_id: c.id, cases: cases.length, by_set: { held: cases.filter((x) => x.set === "held").length, occasion: cases.filter((x) => x.set === "occasion").length }, estimate: est, max_usd: maxUsd, would_run: est.claude_usd <= maxUsd, gemini_configured: Boolean(gkey) });
    if (est.claude_usd > maxUsd) return NextResponse.json({ error: "over_budget", estimate: est, max_usd: maxUsd, hint: "lower n, or raise max_usd (cap 8) with S's approval" }, { status: 409 });

    const live = await liveTemplate(db);
    const deps: GateDeps = {
      polish: (t, x) => polishLyrics(client, { language: x.language, style: x.style, brief: x.brief, lyrics: x.draft }, t ?? live.template),
      judge: (x, polished) => judgePair(client, x.language, x.brief, polished, x.baseline) as Promise<PairJudgment>,
      judgeGemini: gkey ? (x, polished) => judgePairGemini(x.language, x.brief, polished, x.baseline, gkey) : undefined,
      spentUsd: () => meter.usd(),
    };
    const result = await runPolishGate(cases, c.payload.template, deps, { maxUsd });
    const report = { ...result, estimate: est, spend: meter.snapshot(), max_usd: maxUsd, set };
    await db.from("config_versions").update({ eval_report: report, status: report.verdict === "recommend" ? "shadow" : "draft" }).eq("id", c.id);
    if (report.verdict === "recommend" && req.nextUrl.searchParams.get("auto") === "1") {
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
