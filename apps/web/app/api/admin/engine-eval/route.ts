/**
 * /api/admin/engine-eval -- the eval gate for PCE_INTENT (and PCE_JUDGE_RETRY) on stored drafts (Bearer ADMIN_SECRET).
 *
 *   POST ?action=estimate[&set=held|occasion|both&n=15&retry=1]   Case count and expected Claude USD. Spends nothing.
 *   POST ?action=evaluate[&set=..&n=..&retry=1&max_usd=3]           Same stored drafts, polished two ways, judged blind against the same
 *                                                                   best-of-6 baseline by Claude and Gemini:
 *                                                                     live      the live polish template with the plain brief (today)
 *                                                                     candidate the same template with the extracted intent block added to the brief,
 *                                                                               and with retry=1 also the judge-and-retry pass
 * Same promotion rule as the polish gate (runPolishGate). It tests the intent at the polish and judge steps; it does not test
 * intent inside the poets' cascade prompts (that needs live cascade runs). Nothing is promoted by this route: it only reports.
 */
import { NextRequest, NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { extractIntent, intentBlock } from "../../../../lib/engine/intent";
import { judgeAndRetry } from "../../../../lib/engine/judge";
import { estimateGate, meter } from "../../../../lib/eval/cost";
import { judgePair, judgePairGemini } from "../../../../lib/eval/judge";
import { OCCASION_BATCH_SOURCE } from "../../../../lib/eval/occasion-briefs";
import { runPolishGate, type GateCase, type GateDeps, type PairJudgment } from "../../../../lib/eval/polish-gate";
import { livePolishTemplate, polishLyrics } from "../../../../lib/lyrics/polish";
import { screenRequest } from "../../../../lib/safety";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CODE: Record<string, string> = { kannada: "kn", tamil: "ta", telugu: "te", hindi: "hi", bengali: "bn" };
const isHeldOut = (briefId: string) => Number(briefId.split("-")[1]) >= 25;
type Row = { brief_id: string; arm: string; lyrics: string; language: string; style_family: string; brief: string };
const COLS = "brief_id,arm,lyrics,language,style_family,brief";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const action = q.get("action");
  if (action !== "estimate" && action !== "evaluate") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  meter.reset();
  const db = serviceClient(); const client = anthropicClient();
  const set = q.get("set") ?? "both";
  const n = Math.max(1, Math.min(30, Number(q.get("n") ?? 15)));
  const retry = q.get("retry") === "1";
  const maxUsd = Math.min(Number(q.get("max_usd") ?? 3), 4);
  const gkey = process.env.GEMINI_API_KEY;

  const cases: GateCase[] = [];
  const pairOf = (rows: Row[], bid: string) => ({ pce: rows.find((r) => r.brief_id === bid && r.arm === "pce"), base: rows.find((r) => r.brief_id === bid && r.arm === "single") });
  if (set === "held" || set === "both") {
    const { data } = await db.from("eval_runs").select(COLS).eq("batch", "fullA").eq("status", "done");
    const rows = (data ?? []) as Row[];
    for (const bid of [...new Set(rows.map((r) => r.brief_id))].filter(isHeldOut).sort().slice(0, n)) {
      const { pce, base } = pairOf(rows, bid);
      if (pce && base) cases.push({ set: "held", id: bid, language: pce.language, style: pce.style_family, brief: pce.brief, draft: pce.lyrics, baseline: base.lyrics });
    }
  }
  if (set === "occasion" || set === "both") {
    const { data } = await db.from("eval_runs").select(COLS).eq("batch", OCCASION_BATCH_SOURCE).eq("status", "done");
    const rows = (data ?? []) as Row[];
    for (const bid of [...new Set(rows.map((r) => r.brief_id))].sort().slice(0, n)) {
      const { pce, base } = pairOf(rows, bid);
      if (pce && base) cases.push({ set: "occasion", id: bid, language: pce.language, style: pce.style_family, brief: pce.brief, draft: pce.lyrics, baseline: base.lyrics });
    }
  }
  if (cases.length === 0) return NextResponse.json({ error: "no stored drafts for this set" }, { status: 409 });

  // Both arms are recomputed (no stored verdicts), plus about 1 small Haiku intent call per case and 3 small calls per retry.
  const est = estimateGate({ briefs: cases.length, liveRecompute: cases.length });
  const extra = Math.round(cases.length * (retry ? 0.04 : 0.003) * 1000) / 1000;
  const total = Math.round((est.claude_usd + extra) * 1000) / 1000;
  if (action === "estimate") return NextResponse.json({ cases: cases.length, claude_usd: total, retry, breakdown: { ...est.breakdown, intent_and_retry: extra }, max_usd: maxUsd });
  if (total > maxUsd) return NextResponse.json({ error: "over_budget", claude_usd: total, max_usd: maxUsd, hint: "lower n or set; raising max_usd needs S's approval" }, { status: 409 });

  const template = await livePolishTemplate(db);
  const ask = async (x: { model: string; prompt: string; maxTokens: number }) => {
    const res = await client.messages.create({ model: x.model, max_tokens: x.maxTokens, messages: [{ role: "user", content: x.prompt }] });
    meter.record(x.model, res.usage);
    return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  };
  const trace: string[] = [];
  const deps: GateDeps = {
    polish: async (t, c) => {
      if (t === null) return polishLyrics(client, { language: c.language, style: c.style, brief: c.brief, lyrics: c.draft }, template); // live arm
      const code = CODE[c.language.toLowerCase()] ?? c.language;
      const intent = await extractIntent({ prompt: c.brief, language: code, styleFamily: c.style }, ask);
      let lyrics = await polishLyrics(client, { language: c.language, style: c.style, brief: `${c.brief}\n${intentBlock(intent)}`, lyrics: c.draft }, template);
      if (retry) {
        const r = await judgeAndRetry({ intent, lyrics, language: code, targetSeconds: 30 }, { complete: ask, revise: ask, check: async (x) => (await screenRequest(x, "lyrics")).allowed, log: (m) => trace.push(`${c.id}: ${m}`) });
        lyrics = r.lyrics;
      }
      return lyrics;
    },
    judge: (x, polished) => judgePair(client, x.language, x.brief, polished, x.baseline) as Promise<PairJudgment>,
    judgeGemini: gkey ? (x, polished) => judgePairGemini(x.language, x.brief, polished, x.baseline, gkey) : undefined,
    spentUsd: () => meter.usd(),
  };
  const result = await runPolishGate(cases, "engine-intent", deps, { maxUsd });
  return NextResponse.json({ ...result, arms: { live: "live polish template, plain brief", candidate: retry ? "intent block + judge-and-retry" : "intent block" }, estimate: { claude_usd: total }, spend: meter.snapshot(), max_usd: maxUsd, set, retry_trace: trace });
}
