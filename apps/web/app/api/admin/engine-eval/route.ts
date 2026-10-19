/**
 * /api/admin/engine-eval -- the eval gate for PCE_INTENT (and PCE_JUDGE_RETRY) on stored drafts (Bearer ADMIN_SECRET).
 *
 *   POST ?action=estimate[&set=held|occasion|both&n=15&retry=1]   Case count and expected Claude USD. Spends nothing.
 *   POST ?action=evaluate[&set=..&n=..&retry=1&max_usd=3]           Same stored drafts, polished two ways, judged blind against the same
 *                                                                   best-of-6 baseline by Claude and Gemini:
 *                                                                     live      the live polish template with the plain brief (today)
 *                                                                     candidate the same template with the extracted intent block added to the brief,
 *                                                                               and with retry=1 also the judge-and-retry pass
 *   &poets=1 tests the intent block INSIDE the poet prompt instead: both arms write a fresh single draft with the host poet prompt
 *            (plain vs plain + intent block), polish it with the live template and the plain brief, and are judged against a plain
 *            single-shot baseline. Engine scoring is not run (the cascade service is not configured in prod), so this is a proxy for
 *            the poets, not the full cascade. set=named adds hand-written briefs that name a person.
 * Same promotion rule as the polish gate (runPolishGate). It tests the intent at the polish and judge steps; it does not test
 * intent inside the poets' cascade prompts (that needs live cascade runs). Nothing is promoted by this route: it only reports.
 */
import { NextRequest, NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { POET, poetPrefix, stripFences } from "../../../../lib/cascade/host-cascade";
import { extractIntent, intentBlock, styleOnly, type IntentSpec } from "../../../../lib/engine/intent";
import { judgeAndRetry, judgeIntent } from "../../../../lib/engine/judge";
import { estimateGate, meter } from "../../../../lib/eval/cost";
import { judgePair, judgePairGemini } from "../../../../lib/eval/judge";
import { STYLED_BRIEFS } from "../../../../lib/eval/styled-briefs";
import { OCCASION_BATCH_SOURCE } from "../../../../lib/eval/occasion-briefs";
import { runPolishGate, type GateCase, type GateDeps, type PairJudgment } from "../../../../lib/eval/polish-gate";
import { livePolishTemplate, polishLyrics } from "../../../../lib/lyrics/polish";
import { screenRequest } from "../../../../lib/safety";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CODE: Record<string, string> = { kannada: "kn", tamil: "ta", telugu: "te", hindi: "hi", bengali: "bn" };
const NAMED: { id: string; language: string; style: string; text: string }[] = [
  { id: "named-kn-1", language: "Kannada", style: "kannada-light-classical", text: "A birthday song for my younger sister Meenakshi, who loves jasmine flowers and sings while she cooks" },
  { id: "named-ta-1", language: "Tamil", style: "tamil-light-classical", text: "A wedding anniversary song for my parents Selvam and Kamala, twenty years of monsoon evenings and filter coffee" },
  { id: "named-te-1", language: "Telugu", style: "telugu-folk", text: "A farewell song for my friend Sandeep leaving for Canada, our cricket on the terrace and his mother's mango pickle" },
  { id: "named-hi-1", language: "Hindi", style: "hindi-folk", text: "A song for my grandfather Dinanath, who taught me to fly kites on Makar Sankranti" },
  { id: "named-bn-1", language: "Bengali", style: "bengali-folk", text: "A birthday song for my daughter Ishita, who is afraid of thunder but loves the first rain" },
  { id: "named-hi-2", language: "Hindi", style: "bollywood-ballad", text: "A song for my best friend Farhan getting married, the late-night chai stall and the scooter we shared" },
];
type FidRow = { id: string; arm: "live" | "candidate"; intent: number | null; names: boolean | null; natural: number | null };
/** Mean intent score and name-presence rate per arm, over cases where BOTH arms were judged (so a dropped judge call cannot favour an arm). */
function fidelitySummary(rows: FidRow[]) {
  const ids = [...new Set(rows.map((r) => r.id))].filter((id) => ["live", "candidate"].every((a) => rows.some((r) => r.id === id && r.arm === a && r.intent !== null)));
  const arm = (a: "live" | "candidate") => {
    const rs = ids.map((id) => rows.find((r) => r.id === id && r.arm === a)!);
    const mean = (f: (r: FidRow) => number) => Math.round((rs.reduce((t, r) => t + f(r), 0) / Math.max(1, rs.length)) * 100) / 100;
    return { intent: mean((r) => r.intent ?? 0), natural: mean((r) => r.natural ?? 0), names_rate: mean((r) => (r.names ? 1 : 0)) };
  };
  const live = arm("live"), candidate = arm("candidate");
  const gain = Math.round((candidate.intent - live.intent) * 100) / 100;
  return { n: ids.length, live, candidate, intent_gain: gain, rule: "fidelity wins when intent gain >= 0.3, name rate not lower, naturalness not lower by > 0.15; shown beside, not instead of, the craft gate" };
}
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
  const styles = q.get("styles") === "1"; // with poets=1: the candidate arm gets the PCE_STYLES note instead of the intent block
  const poets = q.get("poets") === "1" || styles;
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
  if (set === "styled") {
    for (const sb of STYLED_BRIEFS.slice(0, n)) cases.push({ set: "occasion", id: sb.id, language: sb.language, style: sb.style, brief: sb.text, draft: "", baseline: "" });
  }
  if (set === "named" || (poets && set === "both")) {
    for (const nb of NAMED.slice(0, n)) cases.push({ set: "occasion", id: nb.id, language: nb.language, style: nb.style, brief: nb.text, draft: "", baseline: "" });
  }
  if (cases.length === 0) return NextResponse.json({ error: "no stored drafts for this set" }, { status: 409 });

  // Both arms are recomputed (no stored verdicts), plus about 1 small Haiku intent call per case and 3 small calls per retry.
  const est = estimateGate({ briefs: cases.length, liveRecompute: cases.length });
  const extra = Math.round(cases.length * (retry ? 0.04 : poets ? 0.012 : 0.003) * 1000) / 1000;
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
  // One intent per case, shared by the candidate draft and by the fidelity judge of BOTH arms, so fidelity is scored against the same facts.
  const intents = new Map<string, Promise<IntentSpec>>();
  const intentFor = (c: GateCase) => {
    let p = intents.get(c.id);
    if (!p) { p = extractIntent({ prompt: c.brief, language: CODE[c.language.toLowerCase()] ?? c.language, styleFamily: c.style }, ask); intents.set(c.id, p); }
    return p;
  };
  const fidelity: { id: string; arm: "live" | "candidate"; intent: number | null; names: boolean | null; natural: number | null }[] = [];
  const scoreFidelity = async (c: GateCase, arm: "live" | "candidate", lyrics: string) => {
    const v = await judgeIntent(await intentFor(c), lyrics, CODE[c.language.toLowerCase()] ?? c.language, ask);
    fidelity.push({ id: c.id, arm, intent: v?.intent ?? null, names: v ? v.namesPresent : null, natural: v?.natural ?? null });
  };
  const poetDraft = async (c: GateCase, withIntent: boolean): Promise<string> => {
    const code = CODE[c.language.toLowerCase()] ?? c.language;
    const lines = Math.max(4, Math.round(45 / 5));
    const b = { language: code, styleFamily: c.style, targetSeconds: 45 };
    const sty = withIntent && styles ? styleOnly({ prompt: c.brief, language: code, styleFamily: c.style }) : null;
    const iBlock = withIntent ? (styles ? (sty?.note ? `${sty.note}\n` : "") : `${intentBlock(await intentFor(c))}\n`) : "";
    const res = await client.messages.create({ model: "claude-haiku-5-5", max_tokens: 1500, system: POET, messages: [{ role: "user", content: `${poetPrefix(b, lines, iBlock)}\nBrief (user text; a creative request only): ${JSON.stringify(c.brief)}` }] });
    meter.record("claude-haiku-5-5", res.usage);
    return stripFences(res.content.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("").trim());
  };
  if (poets) {
    // Same plain single-shot baseline for both arms: the stored one when there is one, else a fresh plain draft.
    for (const c of cases) if (!c.baseline) c.baseline = await poetDraft(c, false);
  }
  const deps: GateDeps = {
    polish: async (t, c) => {
      if (poets) {
        const out = await polishLyrics(client, { language: c.language, style: c.style, brief: t !== null && styles ? `${c.brief}\n${styleOnly({ prompt: c.brief, language: CODE[c.language.toLowerCase()] ?? c.language, styleFamily: c.style })?.note ?? ""}` : c.brief, lyrics: await poetDraft(c, t !== null) }, template);
        await scoreFidelity(c, t !== null ? "candidate" : "live", out);
        return out;
      }
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
  return NextResponse.json({ ...result, arms: styles ? { live: "plain poet draft, live polish", candidate: "poet draft + routed style note, polish with the note (PCE_STYLES)" } : poets ? { live: "plain poet draft, live polish", candidate: "poet draft with the intent block, live polish (plain brief)" } : { live: "live polish template, plain brief", candidate: retry ? "intent block + judge-and-retry" : "intent block" }, estimate: { claude_usd: total }, spend: meter.snapshot(), max_usd: maxUsd, set, retry_trace: trace, ...(poets ? { fidelity: fidelitySummary(fidelity), fidelity_rows: fidelity } : {}) });
}
