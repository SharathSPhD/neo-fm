/**
 * /api/admin/ui-review -- operator side of the UI translation review (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 *   POST ?action=token&lang=kn[&alias=Kannada reviewer A][&days=14]   mint a reviewer link; the token is shown once
 *   POST ?action=revoke&id=<token id>   or   ?action=revoke&alias=<alias>
 *   GET  ?action=report                   per-language progress (approved, edited, not yet reviewed)
 *   GET  ?action=patch&lang=kn[&format=md]   approved edits as a patch file for scripts/apply-ui-review.mjs, or a PR-ready table
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import {
  buildPatch, clampDays, hashToken, isReviewLang, newToken, patchMarkdown, REVIEW_LANGS,
} from "../../../../lib/ui-review/core";
import { loadEditsForLanguage } from "../../../../lib/ui-review/load";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

export async function POST(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization")).ok) return deny();
  const p = req.nextUrl.searchParams;
  const action = p.get("action");
  const db = serviceClient();

  if (action === "revoke") {
    const id = p.get("id");
    const alias = p.get("alias");
    if (!id && !alias) return NextResponse.json({ error: "id_or_alias_required" }, { status: 400 });
    if (id && !UUID.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
    let q = db.from("ui_review_tokens").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
    q = id ? q.eq("id", id) : q.eq("alias", alias as string);
    const { data, error } = await q.select("id");
    if (error) return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, revoked: (data ?? []).length });
  }

  if (action === "token") {
    const lang = p.get("lang") ?? "";
    if (!isReviewLang(lang)) return NextResponse.json({ error: "bad_lang", allowed: REVIEW_LANGS }, { status: 400 });
    const alias = (p.get("alias") ?? "").trim().slice(0, 60) || null;
    const token = newToken();
    const days = clampDays(p.get("days"));
    const { data, error } = await db
      .from("ui_review_tokens")
      .insert({ token_hash: hashToken(token), language: lang, alias, expires_at: new Date(Date.now() + days * 86_400_000).toISOString() })
      .select("id, expires_at")
      .single<{ id: string; expires_at: string }>();
    if (error) return NextResponse.json({ error: "insert_failed", detail: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true, id: data.id, language: lang, alias, expires_at: data.expires_at,
      path: `/ui-review/${token}`, note: "token is not stored; copy the link now",
    });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization")).ok) return deny();
  const p = req.nextUrl.searchParams;
  const action = p.get("action");

  if (action === "patch") {
    const lang = p.get("lang") ?? "";
    if (!isReviewLang(lang)) return NextResponse.json({ error: "bad_lang", allowed: REVIEW_LANGS }, { status: 400 });
    const patch = buildPatch(lang, await loadEditsForLanguage(lang));
    if (p.get("format") === "md") {
      return new NextResponse(patchMarkdown(patch), { headers: { "content-type": "text/markdown; charset=utf-8" } });
    }
    return NextResponse.json(patch);
  }

  if (action === "report") {
    const report = [];
    for (const lang of REVIEW_LANGS) {
      const patch = buildPatch(lang, await loadEditsForLanguage(lang));
      report.push({
        language: lang,
        total_keys: patch.total_keys,
        approved: patch.approved_keys.length,
        edited: patch.edits.length,
        not_reviewed: patch.total_keys - patch.approved_keys.length - patch.edits.length,
        stale_ignored: patch.stale,
      });
    }
    return NextResponse.json({ report });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
