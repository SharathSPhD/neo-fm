/**
 * GET /api/referral/code -- the signed-in user's share code, created on first use, for building share links
 * (?ref=<code>). {"enabled":false,"code":null} while REFERRAL_ENABLED is off or the migration is not applied.
 */
import { NextResponse } from "next/server";

import { ensureRefCode } from "@/lib/referral/claim";
import { referralEnabled } from "@/lib/referral/code";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  if (!referralEnabled()) return NextResponse.json({ enabled: false, code: null });
  const code = await ensureRefCode(createServiceRoleClient(), authed.user.id);
  return NextResponse.json({ enabled: code !== null, code });
}
