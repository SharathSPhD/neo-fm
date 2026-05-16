/**
 * /account -- authed account page (Sprint E).
 *
 * Surfaces:
 *   - email, plan badge, member-since date
 *   - "Change password" CTA (sends a Supabase reset email)
 *   - "Export my data" CTA (mints a signed JSON dump of the user's songs
 *     + song_documents; future: include tracks list)
 *   - "Delete account" CTA (hard delete; anonymises published songs)
 *   - "Sign out" + theme toggle already provided by the UserMenu in the shell
 */
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { createServerClient } from "@/lib/supabase/server";

import { AccountActions } from "./account-actions";

export const dynamic = "force-dynamic";

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  creator: "Creator",
  pro: "Pro",
};

export default async function AccountPage() {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/sign-in?next=/account");

  const { data: row } = await supabase
    .from("users")
    .select("tier, created_at")
    .eq("id", auth.user.id)
    .maybeSingle();

  const plan = PLAN_LABEL[row?.tier ?? "free"] ?? "Free";
  const memberSince = row?.created_at
    ? new Date(row.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <Breadcrumbs items={[{ label: "Account" }]} />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-medium tracking-tight">Account</h1>
        <p className="text-sm text-foreground/60">
          Manage your sign-in, plan, and data.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
        <Row label="Email" value={auth.user.email ?? "(unknown)"} />
        <Row
          label="Plan"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="rounded-full border border-accent/30 px-2 py-0.5 text-[10px] uppercase tracking-widest text-accent">
                {plan}
              </span>
              <a
                href="/pricing"
                className="text-xs text-foreground/60 hover:text-foreground"
              >
                Compare plans →
              </a>
            </span>
          }
        />
        {memberSince ? (
          <Row label="Member since" value={memberSince} />
        ) : null}
      </section>

      <AccountActions email={auth.user.email ?? ""} />
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-muted/10 pb-2 last:border-b-0 last:pb-0">
      <span className="text-[10px] uppercase tracking-widest text-foreground/40">
        {label}
      </span>
      <span className="text-sm text-foreground/90">{value}</span>
    </div>
  );
}
