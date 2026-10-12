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

  // DPDP/GDPR erasure must reach everything we hold, not just rows: (1) stop billing and erase the Stripe customer,
  // (2) delete stored audio and cover art, (3) delete free-text feedback. Any failure stops before the auth user is
  // deleted, so the user can retry; deleting first would orphan data we could no longer attribute to them.
  const steps: Record<string, string> = {};
  try {
    if (getBillingConfigOrNull()) {
      const { data: bill } = await admin.from("user_billing").select("stripe_customer_id, stripe_subscription_id").eq("user_id", user.id).maybeSingle();
      const b = bill as { stripe_customer_id: string | null; stripe_subscription_id: string | null } | null;
      const { getStripe } = await import("@/lib/billing/stripe");
      const stripe = getStripe();
      if (b?.stripe_subscription_id) {
        await ignoreMissing(() => stripe.subscriptions.cancel(b.stripe_subscription_id as string));
        steps.subscription = "cancelled";
      }
      if (b?.stripe_customer_id) {
        // Deleting the customer also removes saved payment methods; Stripe keeps invoices it must retain by law.
        await ignoreMissing(() => stripe.customers.del(b.stripe_customer_id as string));
        steps.stripe_customer = "deleted";
      }
    }
  } catch (e) {
    // A failed cancel must not leave the user billed after deletion: stop and tell them.
    return NextResponse.json({ error: "subscription_cancel_failed", details: String((e as Error).message).slice(0, 200) }, { status: 502 });
  }
  try {
    const { data: jobs, error: jobsErr } = await admin.from("jobs").select("id").eq("user_id", user.id);
    if (jobsErr) throw new Error(jobsErr.message);
    let removed = 0;
    for (const j of (jobs ?? []) as { id: string }[]) {
      removed += await removeTree(admin.storage.from("tracks"), j.id);
    }
    removed += await removeTree(admin.storage.from("cover-art"), user.id);
    steps.audio_files_removed = String(removed);
  } catch (e) {
    return NextResponse.json({ error: "storage_delete_failed", details: String((e as Error).message).slice(0, 200) }, { status: 502 });
  }
  // feedback.user_id is ON DELETE SET NULL, which would keep the free text after erasure.
  const fb = await admin.from("feedback").delete().eq("user_id", user.id);
  if (fb.error) {
    return NextResponse.json({ error: "feedback_delete_failed", details: fb.error.message }, { status: 500 });
  }
  steps.feedback = "deleted";

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

async function ignoreMissing(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    // Already cancelled/deleted on a previous (partially failed) attempt: that is the state we want.
    if ((e as { code?: string }).code !== "resource_missing") throw e;
  }
}

type StorageBucket = {
  list: (path: string) => Promise<{ data: { id: string | null; name: string }[] | null; error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

/** Removes every object under `prefix`, descending into sub-folders (Storage lists folders with a null id). */
async function removeTree(bucket: StorageBucket, prefix: string): Promise<number> {
  const { data, error } = await bucket.list(prefix);
  if (error) throw new Error(`storage list ${prefix}: ${error.message}`);
  let removed = 0;
  const files: string[] = [];
  for (const entry of data ?? []) {
    if (entry.id === null) removed += await removeTree(bucket, `${prefix}/${entry.name}`);
    else files.push(`${prefix}/${entry.name}`);
  }
  if (files.length) {
    const res = await bucket.remove(files);
    if (res.error) throw new Error(`storage remove ${prefix}: ${res.error.message}`);
    removed += files.length;
  }
  return removed;
}
