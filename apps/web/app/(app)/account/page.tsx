/**
 * /account -- authed account page.
 *
 * Sprint E (v1.1) shipped:
 *   - email, plan badge, member-since date
 *   - Change password / Export / Delete CTAs
 *   - Sign out + theme toggle (UserMenu)
 *
 * Sprint 5b (v1.2) layers Stripe-aware billing UI on top:
 *   - If billing is enabled AND the user has a row in `user_billing`,
 *     surface subscription status, renewal date, and a "Manage
 *     subscription" button that opens the Stripe Customer Portal.
 *   - If the query string carries `?upgraded=creator|pro` (returned
 *     by checkout success URL), show a one-shot success banner that
 *     reassures the user the upgrade landed. Webhook may not have
 *     finished writing yet, so we soft-message "your plan will update
 *     within a few seconds" rather than asserting the new tier.
 */
import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { isBillingEnabled } from "@/lib/billing/config";
import { createServerClient } from "@/lib/supabase/server";

import { AccountActions } from "./account-actions";
import { ManageBillingButton } from "./manage-billing-button";

export const dynamic = "force-dynamic";

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  creator: "Creator",
  pro: "Pro",
  developer: "Developer",
};

const STATUS_LABEL: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
  unpaid: "Unpaid",
  paused: "Paused",
  inactive: "Inactive",
};

interface PageProps {
  searchParams?: { upgraded?: string };
}

export default async function AccountPage({ searchParams }: PageProps) {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/sign-in?next=/account");

  const { data: row } = await supabase
    .from("users")
    .select("tier, created_at")
    .eq("id", auth.user.id)
    .maybeSingle();

  const billingEnabled = isBillingEnabled();
  // Only query user_billing when billing is on -- the table exists
  // either way, but the column is meaningless in dummy mode.
  const { data: billing } = billingEnabled
    ? await supabase
        .from("user_billing")
        .select(
          "status, current_period_end, cancel_at_period_end, stripe_subscription_id",
        )
        .eq("user_id", auth.user.id)
        .maybeSingle()
    : { data: null as null };

  const plan = PLAN_LABEL[row?.tier ?? "free"] ?? "Free";
  const memberSince = row?.created_at
    ? new Date(row.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : null;

  const upgradedToTier = normalizeUpgradedQuery(searchParams?.upgraded);
  const showUpgradedBanner = upgradedToTier !== null;

  const subscriptionStatusLabel = billing?.status
    ? STATUS_LABEL[billing.status] ?? billing.status
    : null;
  const renews = billing?.current_period_end
    ? new Date(billing.current_period_end).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
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

      {showUpgradedBanner ? (
        <section
          role="status"
          className="rounded-md border border-emerald-400/30 bg-emerald-400/5 px-5 py-3 text-sm text-emerald-200"
        >
          <strong className="font-medium">
            Welcome to {PLAN_LABEL[upgradedToTier!] ?? "your new plan"}.
          </strong>{" "}
          Stripe confirmed payment; your plan will update here within a
          few seconds.
        </section>
      ) : null}

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
        {billing && subscriptionStatusLabel ? (
          <Row label="Subscription" value={subscriptionStatusLabel} />
        ) : null}
        {billing && renews ? (
          <Row
            label={billing.cancel_at_period_end ? "Ends on" : "Renews on"}
            value={renews}
          />
        ) : null}
        {memberSince ? (
          <Row label="Member since" value={memberSince} />
        ) : null}
      </section>

      {billing?.stripe_subscription_id ? (
        <section className="flex flex-col gap-2 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
          <h2 className="text-sm font-medium tracking-tight">Billing</h2>
          <p className="text-xs text-foreground/60">
            Open the Stripe-hosted Customer Portal to change plan, update
            your card, cancel, or download invoices.
          </p>
          <ManageBillingButton />
        </section>
      ) : null}

      <AccountActions email={auth.user.email ?? ""} />
    </div>
  );
}

function normalizeUpgradedQuery(raw: string | undefined): string | null {
  if (raw === "creator" || raw === "pro") return raw;
  return null;
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
