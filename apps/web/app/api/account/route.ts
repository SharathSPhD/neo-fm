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
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user } = authed;

  const admin = createServiceRoleClient();
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
  return NextResponse.json({ deleted: true });
}
