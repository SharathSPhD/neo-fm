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
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { isBillingEnabled } from "@/lib/billing/config";
import { readOwnStationPass } from "@/lib/billing/pass";
import { showPlanChip } from "@/lib/billing/plan-chip";
import { startOfMonthIso } from "@/lib/billing/usage";
import { serverI18n } from "@/lib/i18n/server";
import { loadReferralSummary } from "@/lib/share/referral-load";
import { createServerClient } from "@/lib/supabase/server";

import { AccountActions } from "./account-actions";
import { SocialPanel } from "./social-panel";
import { TastePanel } from "./taste-panel";
import { ManageBillingButton } from "./manage-billing-button";
import { UsageMeter } from "./usage-meter";

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
  searchParams?: Promise<{ upgraded?: string }>;
}

export default async function AccountPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const { t } = await serverI18n();
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/sign-in?next=/account");

  const upgradedToTier = normalizeUpgradedQuery(searchParams?.upgraded);
  const showUpgradedBanner = upgradedToTier !== null;
  const userId = auth.user.id;

  // Only the session check blocks the first paint. The plan/billing rows and the usage meter each stream in behind their own
  // fallback and query in parallel, so one slow lookup no longer holds the whole page on the skeleton.
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <Breadcrumbs items={[{ label: t("nav.account") }]} />
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-medium tracking-tight">{t("nav.account")}</h1>
        <p className="text-sm text-foreground/60">
          {t("account.subtitle")}
        </p>
      </header>

      {showUpgradedBanner ? (
        <section
          role="status"
          className="rounded-md border border-emerald-400/30 bg-emerald-400/5 px-5 py-3 text-sm text-emerald-200"
        >
          <strong className="font-medium">
            {t("account.welcome", { plan: PLAN_LABEL[upgradedToTier!] ?? t("account.newPlan") })}
          </strong>{" "}
          {t("account.upgradeNote")}
        </section>
      ) : null}

      <Suspense fallback={<CardSkeleton rows={3} />}>
        <PlanCards userId={userId} email={auth.user.email ?? t("account.unknown")} />
      </Suspense>

      <Suspense fallback={<CardSkeleton rows={1} />}>
        <UsageCard userId={userId} />
      </Suspense>

      <section className="flex flex-col gap-1 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
        <h2 className="text-lg font-medium">My month in music</h2>
        <p className="text-sm text-foreground/60">Your songs, languages and top track this month, as a story image to share.</p>
        <Link href="/recap" className="text-sm text-accent underline-offset-4 hover:underline">
          Open recap →
        </Link>
      </section>

      <Suspense fallback={null}>
        <ReferralLine userId={userId} />
      </Suspense>

      <TastePanel />
      <SocialPanel />
      <AccountActions email={auth.user.email ?? ""} />
    </div>
  );
}

/** Recognition only: who this listener joined from, and how many joined from them. Silent when neither applies. */
async function ReferralLine({ userId }: { userId: string }) {
  const { t } = await serverI18n();
  const r = await loadReferralSummary(userId);
  if (!r.joinedFrom && r.joined === 0) return null;
  return (
    <section className="flex flex-col gap-1 rounded-md border border-muted/20 bg-muted/5 px-5 py-4 text-sm text-foreground/80">
      {r.joinedFrom ? <p>{t("referral.joined", { handle: r.joinedFrom })}</p> : null}
      {r.joined > 0 ? <p>{t("referral.count", { n: r.joined })}</p> : null}
    </section>
  );
}

/** Email, plan, subscription and billing cards. The users and user_billing reads run together. */
async function PlanCards({ userId, email }: { userId: string; email: string }) {
  const { t } = await serverI18n();
  const supabase = createServerClient();
  // user_billing is only meaningful when billing is on; the table exists either way.
  const [{ data: row }, { data: billing }, pass] = await Promise.all([
    supabase.from("users").select("tier, created_at").eq("id", userId).maybeSingle(),
    isBillingEnabled()
      ? supabase
          .from("user_billing")
          .select("status, current_period_end, cancel_at_period_end, stripe_subscription_id")
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null as null }),
    readOwnStationPass(supabase, userId),
  ]);

  const plan = PLAN_LABEL[row?.tier ?? "free"] ?? "Free";
  const memberSince = row?.created_at
    ? new Date(row.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : null;
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
    <>
      <section className="flex flex-col gap-3 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
        <Row label={t("account.email")} value={email} />
        <Row
          label={t("account.plan")}
          value={
            <span className="inline-flex items-center gap-2">
              {showPlanChip(plan, !!pass) ? (
                <span className="rounded-full border border-accent/30 px-2 py-0.5 text-[10px] uppercase tracking-widest text-accent">
                  {plan}
                </span>
              ) : null}
              {pass ? (
                <span
                  data-testid="station-pass-badge"
                  className="rounded-full border border-accent/60 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-accent"
                >
                  Station pass
                </span>
              ) : null}
              <a
                href="/pricing"
                className="text-xs text-foreground/60 hover:text-foreground"
              >
                {t("account.comparePlans")}
              </a>
            </span>
          }
        />
        {billing && subscriptionStatusLabel ? (
          <Row label={t("account.subscription")} value={subscriptionStatusLabel} />
        ) : null}
        {billing && renews ? (
          <Row
            label={billing.cancel_at_period_end ? t("account.endsOn") : t("account.renewsOn")}
            value={renews}
          />
        ) : null}
        {pass ? (
          <Row
            label={pass.cancelAtPeriodEnd ? t("account.endsOn") : t("account.renewsOn")}
            value={new Date(pass.currentPeriodEnd).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          />
        ) : null}
        {memberSince ? (
          <Row label={t("account.memberSince")} value={memberSince} />
        ) : null}
      </section>

      {billing?.stripe_subscription_id || pass ? (
        <section className="flex flex-col gap-2 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
          <h2 className="text-sm font-medium tracking-tight">{t("account.billing")}</h2>
          <p className="text-xs text-foreground/60">
            {t("account.billingBody")}
          </p>
          <ManageBillingButton />
        </section>
      ) : null}
    </>
  );
}

/** Same definition as user_jobs_count_month: completed jobs finished since the start of the UTC month. A failed lookup hides the meter. */
async function UsageCard({ userId }: { userId: string }) {
  const supabase = createServerClient();
  const [{ data: quotaData, error: quotaErr }, { count: usedCount, error: usedErr }] = await Promise.all([
    supabase.rpc("user_tier_quota", { p_user_id: userId }),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("finished_at", startOfMonthIso()),
  ]);
  if (quotaErr || usedErr || typeof quotaData !== "number" || usedCount === null) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
      <h2 className="text-sm font-medium tracking-tight">Plan usage</h2>
      <UsageMeter quota={quotaData} used={usedCount} />
    </section>
  );
}

function CardSkeleton({ rows }: { rows: number }) {
  return (
    <section aria-hidden className="flex animate-pulse flex-col gap-3 rounded-md border border-muted/20 bg-muted/5 px-5 py-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 w-full rounded bg-muted/20" />
      ))}
    </section>
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
