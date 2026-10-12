import type { SupabaseClient } from "@supabase/supabase-js";

import { computeTaste, userCard, type SignalKind, type TasteSignal } from "./taste";

const KINDS = new Set<SignalKind>(["like", "dislike", "play_pct", "replay", "regenerate", "share", "download", "line_edit"]);

/** Reads the caller's own feedback (RLS) or any user's (service role) and turns it into a profile. */
export async function loadTaste(db: SupabaseClient, userId: string) {
  const { data: ev } = await db
    .from("feedback_events")
    .select("kind,value,job_id,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(300);
  const events = (ev ?? []) as { kind: string; value: number | null; job_id: string | null; created_at: string }[];
  const jobIds = Array.from(new Set(events.map((e) => e.job_id).filter((x): x is string => Boolean(x))));
  const meta = new Map<string, { language: string; style: string }>();
  if (jobIds.length) {
    const { data: jobs } = await db.from("jobs").select("id, song_documents(language, style_family)").in("id", jobIds);
    for (const j of (jobs ?? []) as unknown as { id: string; song_documents: { language: string; style_family: string } | null }[]) {
      if (j.song_documents) meta.set(j.id, { language: j.song_documents.language, style: j.song_documents.style_family });
    }
  }
  const now = Date.now();
  const signals: TasteSignal[] = [];
  for (const e of events) {
    const m = e.job_id ? meta.get(e.job_id) : undefined;
    if (!m || !KINDS.has(e.kind as SignalKind)) continue;
    signals.push({ kind: e.kind as SignalKind, value: e.value, language: m.language, style: m.style, ageMs: now - new Date(e.created_at).getTime() });
  }
  const profile = computeTaste(signals, now);
  return { profile, card: userCard(profile) };
}

export async function hasPersonalizationConsent(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.from("consents").select("withdrawn_at").eq("user_id", userId).eq("purpose", "personalize").limit(1);
  const row = ((data ?? [])[0] as { withdrawn_at: string | null } | undefined);
  return Boolean(row && !row.withdrawn_at);
}
