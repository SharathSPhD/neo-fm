/**
 * /api/admin/lyrics-harness -- offline lab route for the corpus-driven lyrics harness (Bearer ADMIN_SECRET). Nothing is promoted here.
 *
 *   POST ?action=estimate  {arm, n}                                   Expected Claude USD for n songs. Spends nothing.
 *   POST ?action=run       {arm, cases:[{id,language,style,brief,drafts,playbook?}], max_usd}
 *                                                                     Final lyrics per case (drafts[0] is the engine's pick), trace and spend.
 *   POST ?action=probe    {language, style, brief}                    No Claude. Reports PCE_HARNESS_REFS as this deployment reads it and whether the polish brief would get the refs block (same expression as lib/agent/process.ts).
 *   POST ?action=archive  {languages?:[name], limit?}                 No Claude. Distinct finished PCE/single lyrics from eval_runs (the lyric archive), newest first, for corpus harvesting.
 *   POST ?action=score    {items:[{id,language,brief,lyrics}], gemini?, max_usd}
 *                                                                     Pointwise 1-5 scores on five dims, four lyrics per call, Claude plus Gemini when gemini=true. Hard stop at max_usd.
 *   POST ?action=distill   {language, pairs:[{brief,chosen,rejected}], max_usd}
 *                                                                     One Claude call: craft-notes playbook for a language.
 *   POST ?action=gate     {arm, cases:[{id,language,style,brief,draft,baseline}], max_usd}
 *                                                                     The formal polish gate (runPolishGate): the arm's polish vs the live polish of the same draft, both judged blind
 *                                                                     against the same baseline by Claude and Gemini. Reports only; nothing is promoted.
 *   POST ?action=judge     {cases:[{id,language,brief,a,b}], gemini?, max_usd}
 *                                                                     Blind pairwise judge, both orders; Claude, plus Gemini when gemini=true. "pce" = a won.
 * Arms are defined in lib/lyrics/harness/harness.ts. Hard stop: max_usd (capped at 4).
 */
import { NextRequest, NextResponse } from "next/server";

import { anthropicClient, serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { meter } from "../../../../lib/eval/cost";
import { JUDGE_MODEL, judgePair, judgePairGemini } from "../../../../lib/eval/judge";
import { geminiInteract, geminiQaModel } from "../../../../lib/gemini/interactions";
import { estimateArmUsd } from "../../../../lib/lyrics/harness/cost";
import { langCode } from "../../../../lib/lyrics/harness/exemplars";
import { ARMS, refsContext, runHarness } from "../../../../lib/lyrics/harness/harness";
import { POINTWISE_SYSTEM, parsePointwise, pointwisePrompt, type PointwiseItem } from "../../../../lib/lyrics/harness/pointwise";
import { distillPrompt, playbookFor } from "../../../../lib/lyrics/harness/playbook";
import { runPolishGate, type GateCase, type GateDeps, type PairJudgment } from "../../../../lib/eval/polish-gate";
import { livePolishTemplate, polishLyrics, polishLyricsEdits } from "../../../../lib/lyrics/polish";

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

  if (action === "probe") {
    const language = String(body.language ?? ""), style = String(body.style ?? ""), brief = String(body.brief ?? "");
    const flag = process.env.PCE_HARNESS_REFS ?? "";
    const enabled = flag.split(",").map((x) => x.trim()).filter(Boolean).includes(langCode(language));
    const refs = enabled ? refsContext({ language, style, brief }, ARMS.refs!.exemplars, playbookFor(language)) : { text: "", exemplars: 0, ids: [] as string[] };
    return NextResponse.json({ flag, language_code: langCode(language), enabled, exemplars: refs.exemplars, exemplar_ids: refs.ids, refs_chars: refs.text.length, refs_head: refs.text.slice(0, 160) });
  }

  if (action === "archive") {
    const langs = (Array.isArray(body.languages) ? body.languages : []).map((x) => String(x).toLowerCase());
    const limit = Math.max(1, Math.min(3000, Number(body.limit ?? 2000)));
    const { data, error } = await serviceClient().from("eval_runs")
      .select("batch,brief_id,language,style_family,brief,arm,lyrics,created_at").eq("status", "done").not("lyrics", "is", null)
      .order("created_at", { ascending: false }).limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = ((data ?? []) as { language: string; lyrics: string; arm: string; brief_id: string }[])
      .filter((r) => r.lyrics.length >= 60 && (langs.length === 0 || langs.includes(r.language.toLowerCase())));
    return NextResponse.json({ n: rows.length, rows });
  }

  const client = anthropicClient();
  const ask = async (x: { model: string; prompt: string; maxTokens: number }) => {
    const res = await client.messages.create({ model: x.model, max_tokens: x.maxTokens, messages: [{ role: "user", content: x.prompt }] });
    meter.record(x.model, res.usage);
    return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  };

  if (action === "score") {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40) as PointwiseItem[];
    const gkey = body.gemini === true ? process.env.GEMINI_API_KEY : undefined;
    const results: Record<string, { claude?: unknown; gemini?: unknown }> = {};
    let skipped = 0;
    for (let i = 0; i < items.length; i += 4) {
      if (meter.usd() >= maxUsd) { skipped = items.length - i; break; }
      const batch = items.slice(i, i + 4), ids = batch.map((x) => x.id), text = pointwisePrompt(batch);
      const [c, g] = await Promise.all([
        client.messages.create({ model: JUDGE_MODEL, max_tokens: 700, system: POINTWISE_SYSTEM, messages: [{ role: "user", content: text }] })
          .then((res) => { meter.record(JUDGE_MODEL, res.usage); return parsePointwise(res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""), ids); })
          .catch(() => new Map()),
        gkey ? geminiInteract({ apiKey: gkey, model: geminiQaModel(), json: true, system: POINTWISE_SYSTEM, text }).then((r) => parsePointwise(r.text, ids)).catch(() => new Map()) : Promise.resolve(new Map()),
      ]);
      for (const id of ids) results[id] = { claude: c.get(id) ?? null, gemini: gkey ? (g.get(id) ?? null) : undefined };
    }
    return NextResponse.json({ n: Object.keys(results).length, requested: items.length, skipped_for_budget: skipped, results, spend: meter.snapshot(), max_usd: maxUsd });
  }

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
          polish: (a) => (cfg.edits ? polishLyricsEdits(client, a, template) : polishLyrics(client, a, template, undefined, cfg.model)),
          ask,
          prefers: async (a) => (await judgePair(client, a.language, a.brief, a.revised, a.previous)).winner === "pce",
          shuffle: (xs) => seededShuffle(xs, c.id),
        });
        out.push({ id: c.id, lyrics: r.lyrics, trace: r.trace });
      } catch (e) { out.push({ id: c.id, lyrics: null, trace: [], error: (e as Error).message.slice(0, 120) }); }
    }));
    return NextResponse.json({ arm: body.arm, results: out, spend: meter.snapshot(), max_usd: maxUsd });
  }

  if (action === "gate") {
    const cfg = ARMS[String(body.arm)];
    if (!cfg) return NextResponse.json({ error: "unknown arm", arms: Object.keys(ARMS) }, { status: 400 });
    const cases = (Array.isArray(body.cases) ? body.cases : []).slice(0, 10) as { id: string; language: string; style: string; brief: string; draft: string; baseline: string }[];
    const gkey = process.env.GEMINI_API_KEY;
    const template = await livePolishTemplate(serviceClient());
    const gcases: GateCase[] = cases.map((c) => ({ set: "occasion", id: c.id, language: c.language, style: c.style, brief: c.brief, draft: c.draft, baseline: c.baseline }));
    const deps: GateDeps = {
      // template === null is the live arm; otherwise the harness arm on the same draft.
      polish: async (t, c) => t === null
        ? polishLyrics(client, { language: c.language, style: c.style, brief: c.brief, lyrics: c.draft }, template)
        : (await runHarness(cfg, { language: c.language, style: c.style, brief: c.brief, drafts: [c.draft] }, { polish: (a) => (cfg.edits ? polishLyricsEdits(client, a, template) : polishLyrics(client, a, template, undefined, cfg.model)), ask, prefers: async () => true })).lyrics,
      judge: (x, polished) => judgePair(client, x.language, x.brief, polished, x.baseline) as Promise<PairJudgment>,
      judgeGemini: gkey ? (x, polished) => judgePairGemini(x.language, x.brief, polished, x.baseline, gkey) : undefined,
      spentUsd: () => meter.usd(),
    };
    const result = await runPolishGate(gcases, `harness-${body.arm}`, deps, { maxUsd });
    return NextResponse.json({ ...result, arms: { live: "live polish of the draft", candidate: `harness arm ${body.arm} on the same draft` }, spend: meter.snapshot(), max_usd: maxUsd });
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
