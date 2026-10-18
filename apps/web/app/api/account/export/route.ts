/**
 * GET /api/account/export
 *
 * Builds a JSON dump of the authenticated user's data: profile,
 * songs, song_documents, and (signed-URL-free) track metadata. We
 * deliberately do not embed the audio bytes -- the response would
 * blow past Vercel's 4.5 MB serverless body cap for any user with
 * more than a handful of songs. The user can re-download each
 * audio file from /library after the export.
 */
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { serviceClient } from "@/lib/agent/adapters";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  const [{ data: profile, error: profile_error }, { data: jobs, error: jobs_error }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, tier, created_at, handle, bio, avatar_path")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select(
        `
        id,
        status,
        error,
        created_at,
        finished_at,
        public_id,
        published_visibility,
        song_documents (
          id, language, style_family, document_json, title, created_at
        ),
        tracks (
          id, url, duration_seconds, format, bytes, created_at
        )
      `,
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  // v2 personal data (service role, strictly filtered to this user): consent records, taste profile, feedback signals,
  // lyrics as sung, billing mirror. Internal telemetry carries no personal content and is omitted.
  const admin = serviceClient(); // untyped client: v2 tables are not in the generated Database types
  const [consents, taste, feedback, billing, runs, presets, likes, follows, prefs, freeText, notifs, notifPrefs, pushSubs] = await Promise.all([
    admin.from("consents").select("*").eq("user_id", user.id),
    admin.from("taste_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("feedback_events").select("*").eq("user_id", user.id),
    admin.from("user_billing").select("status, stripe_price_id, current_period_end, cancel_at_period_end, created_at").eq("user_id", user.id).maybeSingle(),
    admin.from("agent_runs").select("job_id, lyrics, polished_lyrics, diction_qa, updated_at").in("job_id", ((jobs ?? []) as { id: string }[]).map((j) => j.id)),
    admin.from("user_presets").select("*").eq("user_id", user.id),
    admin.from("song_likes").select("*").eq("user_id", user.id),
    admin.from("follows").select("*").eq("follower_id", user.id),
    admin.from("preference_pairs").select("*").eq("user_id", user.id),
    admin.from("feedback").select("*").eq("user_id", user.id),
    admin.from("notifications").select("id, type, data, count, created_at, read_at").eq("user_id", user.id),
    admin.from("notification_prefs").select("prefs, updated_at").eq("user_id", user.id).maybeSingle(),
    // Push keys and endpoints are credentials: the export lists that a device is subscribed, never the secrets.
    admin.from("push_subscriptions").select("created_at, user_agent, endpoint").eq("user_id", user.id),
  ]);

  // Notification tables arrive with migration 0085; before it a missing table just means empty sections.
  const missing = (r: { error?: { code?: string; message?: string } | null }) =>
    !!r.error && (r.error.code === "42P01" || r.error.code === "PGRST205" || /does not exist|schema cache/i.test(r.error.message ?? ""));

  // A failed query would otherwise yield a silently incomplete export, which is worse than an error for a DPDP request.
  const failed = [profile_error, jobs_error, consents, taste, feedback, billing, runs, presets, likes, follows, prefs, freeText, ...[notifs, notifPrefs, pushSubs].filter((r) => !missing(r))]
    .map((r) => (r as { error?: { message: string } | null } | null)?.error)
    .find(Boolean);
  if (failed) {
    return NextResponse.json({ error: "export_failed", details: failed.message }, { status: 500 });
  }

  const payload = {
    export_version: 4,
    exported_at: new Date().toISOString(),
    user: profile ?? { id: user.id, email: user.email ?? null },
    songs: jobs ?? [],
    consents: consents.data ?? [],
    taste_profile: taste.data ?? null,
    feedback_events: feedback.data ?? [],
    billing: billing.data ?? null,
    lyrics_and_pronunciation_checks: runs.data ?? [],
    presets: presets.data ?? [],
    likes: likes.data ?? [],
    follows: follows.data ?? [],
    preference_pairs: prefs.data ?? [],
    feedback: freeText.data ?? [],
    notifications: notifs.data ?? [],
    notification_preferences: notifPrefs.data ?? null,
    push_subscriptions: ((pushSubs.data ?? []) as { created_at: string; user_agent: string | null; endpoint: string }[]).map((s) => ({
      subscribed_at: s.created_at,
      user_agent: s.user_agent,
      push_service: (() => { try { return new URL(s.endpoint).hostname; } catch { return null; } })(),
    })),
  };

  const body = JSON.stringify(payload, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="neo-fm-export-${user.id.slice(0, 8)}.json"`,
      "cache-control": "no-store",
    },
  });
}
