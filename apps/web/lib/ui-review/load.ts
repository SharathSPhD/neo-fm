import "server-only";

import { serviceClient } from "../agent/adapters";
import { hashToken, isWellFormedToken, type EditRow, type ReviewLang } from "./core";

export interface Reviewer {
  id: string;
  language: ReviewLang;
  alias: string | null;
}

/** Resolves a link token to its reviewer, or null when malformed, unknown, expired or revoked. */
export async function resolveReviewer(token: string): Promise<Reviewer | null> {
  if (!isWellFormedToken(token)) return null;
  const db = serviceClient();
  const { data } = await db
    .from("ui_review_tokens")
    .select("id, language, alias")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<Reviewer>();
  if (!data) return null;
  await db.from("ui_review_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

export interface MyEdit {
  action: "approve" | "edit";
  suggestion: string | null;
  comment: string | null;
  base_text: string;
}

export async function loadMyEdits(reviewer: Reviewer): Promise<Record<string, MyEdit>> {
  const { data } = await serviceClient()
    .from("ui_review_edits")
    .select("key, action, suggestion, comment, base_text")
    .eq("token_id", reviewer.id);
  return Object.fromEntries(((data ?? []) as (MyEdit & { key: string })[]).map(({ key, ...rest }) => [key, rest]));
}

/** Every reviewer's edits for one language, for patch building. */
export async function loadEditsForLanguage(lang: ReviewLang): Promise<EditRow[]> {
  const { data } = await serviceClient()
    .from("ui_review_edits")
    .select("token_id, key, action, suggestion, comment, base_text, updated_at, ui_review_tokens!inner(language)")
    .eq("ui_review_tokens.language", lang);
  return ((data ?? []) as unknown as (EditRow & { ui_review_tokens: unknown })[]).map(({ ui_review_tokens: _t, ...r }) => r);
}
