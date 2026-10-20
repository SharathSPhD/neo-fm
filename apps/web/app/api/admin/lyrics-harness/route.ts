/**
 * /api/admin/lyrics-harness -- offline lab route for the corpus-driven lyrics harness (Bearer ADMIN_SECRET). Nothing is promoted here.
 *
 *   POST ?action=estimate  {arm, n}                                   Expected Claude USD for n songs. Spends nothing.
 *   POST ?action=run       {arm, cases:[{id,language,style,brief,drafts,playbook?}], max_usd}
 *                                                                     Final lyrics per case (drafts[0] is the engine's pick), trace and spend.
 *   POST ?action=distill   {language, pairs:[{brief,chosen,rejected}], max_usd}
 *                                                                     One Claude call: craft-notes playbook for a language.
 *   POST ?action=judge     {cases:[{id,language,brief,a,b}], gemini?, max_usd}
 *                                                                     Blind pairwise judge, both orders; Claude, plus Gemini when gemini=true. "pce" = a won.
 * Arms are defined in lib/lyrics/harness/harness.ts. Hard stop: max_usd (capped at 4).
 */
import { NextRequest, NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { meter } from "../../../../lib/eval/cost";
import { judgePair, judgePairGemini } from "../../../../lib/eval/judge";
import { estimateArmUsd } from "../../../../lib/lyrics/harness/cost";
import { ARMS, runHarness } from "../../../../lib/lyrics/harness/harness";
import { distillPrompt } from "../../../../lib/lyrics/harness/playbook";
import { livePolishTemplate, polishLyrics } from "../../../../lib/lyrics/polish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CaseIn { id: string; language: string; style: string; brief: string; drafts: string[]; playbook?: string }

/** Seeded Fisher-Yates so the listwise pick is blind to draft order yet reproducible per brief. */
function seededShuffle<T>(xs: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const maxUsd = Math.min(Number(body.max_usd ?? 1), 4);
  meter.reset();

  if (action === "estimate") {
    const cfg = ARMS[String(body.arm)];
    if (!cfg) return NextResponse.json({ error: "unknown arm", arms: Object.keys(ARMS) }, { status: 400 });
    const n = Math.max(1, Math.min(200, Number(body.n ?? 40)));
    const per = estimateArmUsd(cfg);
    return NextResponse.json({ arm: body.arm, config: cfg, per_song_usd: per, total_usd: Math.round(per * n * 100) / 100, n, note: "upper bound if every round runs; recalibrate from the spend block" });
  }

  const client = anthropicClient();
  const ask = async (x: { model: string; prompt: string; maxTokens: number }) => {
    const res = await client.messages.create({ model: x.model, max_tokens: x.maxTokens, messages: [{ role: "user", content: x.prompt }] });
    meter.record(x.model, res.usage);
    return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  };

  if (action === "distill") {
    const pairs = (Array.isArray(body.pairs) ? body.pairs : []).slice(0, 40) as { brief: string; chosen: string; rejected: string }[];
    const language = String(body.language ?? "");
    if (!language || pairs.length < 5) return NextResponse.json({ error: "need language and >= 5 pairs" }, { status: 400 });
    const playbook = await ask({ model: "claude-sonnet-5-5", prompt: distillPrompt({ language, pairs }), maxTokens: 1500 });
    return NextResponse.json({ language, pairs: pairs.length, playbook, spend: meter.snapshot() });
  }

  if (action === "run") {
    const cfg = ARMS[String(body.arm)];
    if (!cfg) return NextResponse.json({ error: "unknown arm", arms: Object.keys(ARMS) }, { status: 400 });
    const cases = (Array.isArray(body.cases) ? body.cases : []).slice(0, 5) as CaseIn[];
    const template = await livePolishTemplate(serviceClient());
    const out: { id: string; lyrics: string | null; trace: string[]; error?: string }[] = [];
    await Promise.all(cases.map(async (c) => {
      if (meter.usd() >= maxUsd) { out.push({ id: c.id, lyrics: null, trace: [], error: "budget" }); return; }
      try {
        const r = await runHarness(cfg, { language: c.language, style: c.style, brief: c.brief, drafts: c.drafts, playbook: c.playbook }, {
          polish: (a) => polishLyrics(client, a, template),
          ask,
          prefers: async (a) => (await judgePair(client, a.language, a.brief, a.revised, a.previous)).winner === "pce",
          shuffle: (xs) => seededShuffle(xs, c.id),
        });
        out.push({ id: c.id, lyrics: r.lyrics, trace: r.trace });
      } catch (e) { out.push({ id: c.id, lyrics: null, trace: [], error: (e as Error).message.slice(0, 120) }); }
    }));
    return NextResponse.json({ arm: body.arm, results: out, spend: meter.snapshot(), max_usd: maxUsd });
  }

  if (action === "judge") {
    const cases = (Array.isArray(body.cases) ? body.cases : []).slice(0, 10) as { id: string; language: string; brief: string; a: string; b: string }[];
    const gkey = body.gemini === true ? process.env.GEMINI_API_KEY : undefined;
    const out: { id: string; claude: unknown; gemini?: unknown }[] = [];
    for (let i = 0; i < cases.length; i += 5) {
      if (meter.usd() >= maxUsd) break;
      out.push(...(await Promise.all(cases.slice(i, i + 5).map(async (c) => {
        const claude = await judgePair(client, c.language, c.brief, c.a, c.b).catch(() => ({ winner: "error" as const, detail: null }));
        const gemini = gkey ? await judgePairGemini(c.language, c.brief, c.a, c.b, gkey).catch(() => ({ winner: "error" as const, detail: null })) : undefined;
        return { id: c.id, claude, gemini };
      }))));
    }
    return NextResponse.json({ results: out, spend: meter.snapshot(), max_usd: maxUsd });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
