/** POST /api/ui-review/[token]/items -- record one reviewer's verdict on one UI string (the link token is the credential). */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { serviceClient } from "../../../../../lib/agent/adapters";
import { UI_STRINGS, type UiKey } from "../../../../../lib/i18n/ui-strings";
import { MAX_COMMENT, MAX_SUGGESTION, validateSuggestion } from "../../../../../lib/ui-review/core";
import { resolveReviewer } from "../../../../../lib/ui-review/load";

export const dynamic = "force-dynamic";

const Body = z.object({
  key: z.string().max(120),
  action: z.enum(["approve", "edit", "clear"]),
  suggestion: z.string().max(MAX_SUGGESTION).optional(),
  comment: z.string().trim().max(MAX_COMMENT).optional(),
});

const noStore = { "cache-control": "no-store" };

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const reviewer = await resolveReviewer(params.token);
  if (!reviewer) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400, headers: noStore });
  const { key, action, suggestion, comment } = parsed.data;
  if (!(key in UI_STRINGS.en)) return NextResponse.json({ error: "unknown_key" }, { status: 400, headers: noStore });
  const db = serviceClient();

  if (action === "clear") {
    const { error } = await db.from("ui_review_edits").delete().eq("token_id", reviewer.id).eq("key", key);
    if (error) return NextResponse.json({ error: "save_failed" }, { status: 500, headers: noStore });
    return NextResponse.json({ ok: true }, { headers: noStore });
  }

  const en = UI_STRINGS.en[key as UiKey];
  if (action === "edit") {
    const v = validateSuggestion(en, suggestion ?? "");
    if (v !== "ok") return NextResponse.json({ error: v }, { status: 400, headers: noStore });
  }
  const { error } = await db.from("ui_review_edits").upsert(
    {
      token_id: reviewer.id,
      key,
      action,
      suggestion: action === "edit" ? (suggestion as string).trim() : null,
      comment: comment || null,
      base_text: UI_STRINGS[reviewer.language][key as UiKey],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "token_id,key" },
  );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
