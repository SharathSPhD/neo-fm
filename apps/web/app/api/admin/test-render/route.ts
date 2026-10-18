/**
 * POST /api/admin/test-render (Bearer ADMIN_SECRET via checkAdminBearer)
 *   { items: [{ label, language, lyrics?, brief_id?, style? }] }   at most TEST_RENDER_MAX items per call (default 3, hard cap 5)
 * Renders each item with the same Lyria path a user job takes (moderation screen, romanized singing script, diction hints,
 * the 60 s full model) so operators can measure render cost and quality. There is no user, job or quota here, so the cap
 * above and the spend estimate in the response are the only guards: the caller owns the budget. `brief_id` loads the stored
 * PCE lyrics of an eval brief (batch occA). Audio goes to `tracks/admin-test/` and comes back as 24 h signed URLs.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { estimatedCostGbp, generateMusic, type SpendGuard } from "../../../../lib/agent/lyria";
import { dictionHints } from "../../../../lib/diction";
import { ROMAN_HINT, singingScript } from "../../../../lib/diction/romanize";
import { renderCap, validateItems } from "../../../../lib/admin/test-render";
import { getLogger } from "../../../../lib/obs/log";
import { screenRequest } from "../../../../lib/safety";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TARGET_SECONDS = 60;
const DEFAULT_STYLE = "A warm, melodic song with acoustic instruments and a clear lead vocal, suited to the language and occasion.";
export async function POST(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "no_gemini_key" }, { status: 503 });
  const v = validateItems(await req.json().catch(() => null), renderCap());
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const db = serviceClient();
  // Spend is bounded by the per-call item cap, not a ledger: there is no user to charge. The guard only satisfies generateMusic.
  const guard: SpendGuard = { reserve: async () => true, release: async () => {} };
  const results = await Promise.all(v.items.map(async (it) => {
    const started = Date.now();
    try {
      let lyrics = it.lyrics ?? "";
      if (!lyrics) {
        const { data } = await db.from("eval_runs").select("lyrics").eq("batch", "occA").eq("brief_id", it.brief_id ?? "").eq("arm", "pce").maybeSingle();
        lyrics = (data as { lyrics?: string } | null)?.lyrics ?? "";
      }
      if (!lyrics) return { label: it.label, error: "no_lyrics" };
      const style = it.style ?? DEFAULT_STYLE;
      const verdict = await screenRequest(`${style}\n${lyrics}`, "lyrics");
      if (!verdict.allowed) return { label: it.label, error: "moderation_refused" };
      const ss = singingScript(lyrics);
      const r = await generateMusic(
        { stylePrompt: [style, dictionHints(it.language), ss.romanized ? ROMAN_HINT : ""].filter(Boolean).join(" "), lyrics: ss.romanized ? ss.text : lyrics, durationClass: "full", targetSeconds: TARGET_SECONDS },
        { guard, apiKey: key },
      );
      const path = `admin-test/${it.label}.mp3`;
      const up = await db.storage.from("tracks").upload(path, r.audio, { contentType: r.mimeType, upsert: true });
      if (up.error) return { label: it.label, error: `upload: ${up.error.message}` };
      const signed = await db.storage.from("tracks").createSignedUrl(path, 86400);
      return { label: it.label, model: r.model, bytes: r.audio.length, render_ms: Date.now() - started, url: signed.data?.signedUrl ?? null };
    } catch (e) {
      return { label: it.label, error: String((e as Error).message).slice(0, 200) };
    }
  }));
  const ok = results.filter((r) => "url" in r).length;
  const est_cost_gbp = Math.round(ok * estimatedCostGbp("full") * 100) / 100;
  // No ledger row backs these renders, so the log line is the only record of what an operator spent.
  getLogger("/api/admin/test-render", req).info("admin_test_render", { requested: v.items.length, renders_ok: ok, est_cost_gbp, labels: v.items.map((i) => i.label) });
  return NextResponse.json({
    results,
    renders_ok: ok,
    est_cost_gbp,
    cost_basis: "estimate (LYRIA_COST_GBP_FULL, default 0.25), not Google billing",
  });
}
