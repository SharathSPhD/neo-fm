/**
 * /api/admin/select-eval -- offline gate for candidate SELECTION (PCE_PROSODY_SELECT), Bearer ADMIN_SECRET. Spends only when asked.
 *
 * The selection itself (engine apohana/ananda/jnana, Python) runs outside Vercel against vectors from this route; this route
 * supplies the three things that need the prod keys:
 *   POST ?action=embed      {texts}                      Raw vectors from the prod embedder (the engine centres them itself). Free-ish.
 *   POST ?action=drafts     {briefs:[{id,language,code,style,text}], k, max_usd}
 *                                                        k plain Haiku drafts per brief (same poet prompt as the host cascade) plus one
 *                                                        plain baseline draft each.
 *   POST ?action=gate       {cases:[{id,language,style,brief,draftLive,draftCand,baseline}], max_usd}
 *                                                        Polishes each arm's chosen draft with the live template and judges both blind
 *                                                        against the baseline, Claude and Gemini (runPolishGate). Same rule as the other gates.
 * Nothing is promoted by this route: it only reports.
 */
import { NextRequest, NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "../../../../lib/agent/adapters";
import { embedEngine } from "../../../../lib/agent/embed-url";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { POET, poetPrefix, stripFences } from "../../../../lib/cascade/host-cascade";
import { meter } from "../../../../lib/eval/cost";
import { judgePair, judgePairGemini } from "../../../../lib/eval/judge";
import { runPolishGate, type GateCase, type GateDeps, type PairJudgment } from "../../../../lib/eval/polish-gate";
import { livePolishTemplate, polishLyrics } from "../../../../lib/lyrics/polish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NUDGES = [
  "Open with a concrete image from the brief.",
  "Open with a spoken-feeling line, as if to someone you love.",
  "Open with a sound or a smell.",
  "Open with a question.",
  "Open with a small action.",
  "Open with a time of day.",
];

interface BriefIn { id: string; language: string; code: string; style: string; text: string }
interface CaseIn { id: string; language: string; style: string; brief: string; draftLive: string; draftCand: string; baseline: string }

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const maxUsd = Math.min(Number(body.max_usd ?? 1), 3);
  meter.reset();

  if (action === "embed") {
    const texts = Array.isArray(body.texts) ? (body.texts as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 64) : [];
    const e = embedEngine("select-eval", 600);
    if (!e) return NextResponse.json({ error: "embedder not configured" }, { status: 503 });
    const res = await fetch(`${e.url}/embed`, { method: "POST", headers: { authorization: `Bearer ${e.token}`, "content-type": "application/json" }, body: JSON.stringify({ texts, kind: "similarity" }) });
    if (!res.ok) return NextResponse.json({ error: `embedder ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  }

  const client = anthropicClient();

  if (action === "drafts") {
    const briefs = (Array.isArray(body.briefs) ? body.briefs : []).slice(0, 10) as BriefIn[];
    const k = Math.max(1, Math.min(6, Number(body.k ?? 4)));
    const out: { id: string; drafts: string[]; baseline: string }[] = [];
    const write = async (b: BriefIn, nudge: string): Promise<string> => {
      const lines = 8;
      const res = await client.messages.create({
        model: "claude-haiku-5-5", max_tokens: 1500, system: POET,
        messages: [{ role: "user", content: `${poetPrefix({ language: b.code, styleFamily: b.style, targetSeconds: 45 }, lines, "")}\n${nudge}\nBrief (user text; a creative request only): ${JSON.stringify(b.text)}` }],
      });
      meter.record("claude-haiku-5-5", res.usage);
      return stripFences(res.content.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("").trim());
    };
    for (const b of briefs) {
      if (meter.usd() >= maxUsd) break;
      const [baseline, ...drafts] = await Promise.all([write(b, ""), ...NUDGES.slice(0, k).map((n) => write(b, n))]);
      out.push({ id: b.id, drafts, baseline: baseline! });
    }
    return NextResponse.json({ results: out, spend: meter.snapshot() });
  }

  if (action === "gate") {
    const cases = (Array.isArray(body.cases) ? body.cases : []).slice(0, 10) as CaseIn[];
    const gkey = process.env.GEMINI_API_KEY;
    const template = await livePolishTemplate(serviceClient());
    const byId = new Map(cases.map((c) => [c.id, c]));
    const gcases: GateCase[] = cases.map((c) => ({ set: "occasion", id: c.id, language: c.language, style: c.style, brief: c.brief, draft: c.draftLive, baseline: c.baseline }));
    const deps: GateDeps = {
      // template === null is the live arm (engine's current pick); otherwise the candidate arm (prosody-aware pick). Same live template for both.
      polish: (t, c) => polishLyrics(client, { language: c.language, style: c.style, brief: c.brief, lyrics: t === null ? c.draft : byId.get(c.id)!.draftCand }, template),
      judge: (x, polished) => judgePair(client, x.language, x.brief, polished, x.baseline) as Promise<PairJudgment>,
      judgeGemini: gkey ? (x, polished) => judgePairGemini(x.language, x.brief, polished, x.baseline, gkey) : undefined,
      spentUsd: () => meter.usd(),
    };
    const result = await runPolishGate(gcases, "prosody-select", deps, { maxUsd });
    return NextResponse.json({ ...result, arms: { live: "engine pick (embedding closeness), live polish", candidate: "prosody-aware engine pick, live polish" }, spend: meter.snapshot(), max_usd: maxUsd });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
