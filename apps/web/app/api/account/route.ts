/**
 * DELETE /api/account
 *
 * Hard-deletes the authenticated user's account.
 *
 * The `public.users.id` -> `auth.users.id` FK is `on delete cascade`,
 * and `public.jobs.user_id` is `on delete cascade` too, so deleting
 * the auth.users row tears down the whole graph:
 *
 *     auth.users -> public.users -> public.jobs -> tracks
 *                                              -> song_documents (via FK)
 *
 * That includes any published songs the user owns. The current
 * UX surface tells the user "Songs you've published stay live but
 * become anonymous"; in v1.1 we don't actually have a re-parenting
 * path because `jobs.user_id` is NOT NULL, so the cascade deletes
 * them too. ADR 0021 (Sprint I) will introduce a re-parent step
 * to a sentinel "deleted-user" account so /s/[publicId] links keep
 * working for already-shared songs.
 *
 * Requires the service-role key for the auth.users deletion. The
 * user is authenticated via cookies first so a leaked key alone
 * can't be used to delete random accounts.
 */
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/supabase/auth";
import { getBillingConfigOrNull } from "@/lib/billing/config";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user } = authed;

  const admin = createServiceRoleClient();

  // DPDP/GDPR erasure must reach everything we hold, not just rows: (1) stop billing, (2) delete stored audio.
  const steps: Record<string, string> = {};
  try {
    if (getBillingConfigOrNull()) {
      const { data: bill } = await admin.from("user_billing").select("stripe_subscription_id").eq("user_id", user.id).maybeSingle();
      const subId = (bill as { stripe_subscription_id: string | null } | null)?.stripe_subscription_id;
      if (subId) {
        const { getStripe } = await import("@/lib/billing/stripe");
        await getStripe().subscriptions.cancel(subId);
        steps.subscription = "cancelled";
      }
    }
  } catch (e) {
    // A failed cancel must not leave the user billed after deletion: stop and tell them.
    return NextResponse.json({ error: "subscription_cancel_failed", details: String((e as Error).message).slice(0, 200) }, { status: 502 });
  }
  try {
    const { data: jobs } = await admin.from("jobs").select("id").eq("user_id", user.id);
    const bucket = admin.storage.from("tracks");
    let removed = 0;
    for (const j of (jobs ?? []) as { id: string }[]) {
      const { data: files } = await bucket.list(j.id);
      const paths = (files ?? []).map((f) => `${j.id}/${f.name}`);
      if (paths.length) { await bucket.remove(paths); removed += paths.length; }
    }
    steps.audio_files_removed = String(removed);
  } catch { steps.audio_files_removed = "partial"; }

  const deleteAuth = await admin.auth.admin.deleteUser(user.id);
  if (deleteAuth.error) {
    return NextResponse.json(
      {
        error: "delete_auth_user_failed",
        details: deleteAuth.error.message,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ deleted: true, steps });
}
