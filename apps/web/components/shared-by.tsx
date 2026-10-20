import Link from "next/link";

import { ReferralCapture } from "@/components/referral";
import { serverI18n } from "@/lib/i18n/server";
import { cleanRef } from "@/lib/share/referral";
import { createServerClient } from "@/lib/supabase/server";

/**
 * "Shared with you from @handle's station" on a shared song or track page, plus remembering the sharer in this browser so
 * a later sign-up can say "joined from a friend". Renders nothing unless `ref` is a handle that exists. Recognition only.
 */
export async function SharedBy({ refParam }: { refParam: string | string[] | undefined }) {
  const handle = cleanRef(Array.isArray(refParam) ? refParam[0] : refParam);
  if (!handle) return null;
  const { data } = await (
    createServerClient().from("public_profiles" as never) as unknown as {
      select: (c: string) => { ilike: (k: string, v: string) => { limit: (n: number) => Promise<{ data: { handle: string | null }[] | null }> } };
    }
  )
    .select("handle")
    .ilike("handle", handle)
    .limit(5);
  // "_" is a one-character wildcard in ilike, so compare the handle exactly.
  const found = (data ?? []).find((r) => r.handle?.toLowerCase() === handle);
  if (!found?.handle) return null;
  const { t } = await serverI18n();
  return (
    <>
      <ReferralCapture />
      <p className="text-sm text-foreground/70">
        <Link href={`/u/${found.handle}`} className="underline decoration-accent/60 underline-offset-2 hover:text-foreground">
          {t("referral.sharedBy", { handle: found.handle })}
        </Link>
      </p>
    </>
  );
}
