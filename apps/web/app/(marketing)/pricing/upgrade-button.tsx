"use client";

/**
 * "Upgrade to Creator/Pro" button. Renders only when billing is enabled
 * AND the visitor is signed in -- the server-side `pricing/page.tsx`
 * picks between this component and the WaitlistButton based on
 * `isBillingEnabled()`.
 *
 * Flow:
 *   1. POST /api/billing/checkout { tier }
 *   2. window.location = response.url (Stripe Checkout)
 *
 * Error paths:
 *   - 401 from the API -> redirect to /sign-in?next=/pricing (the UI is
 *     supposed to gate this away, but defensively handle it).
 *   - 503 billing_disabled -> show the same "thanks, we'll be in touch"
 *     copy the waitlist uses. This shouldn't happen because the server
 *     component checks the flag, but if env is removed between SSR and
 *     the click we land here.
 *   - Any other failure -> inline error message + a try-again button.
 */
import { useState, useTransition } from "react";

import { sendFunnelEvent } from "@/components/funnel-beacon";
import { checkoutErrorView } from "@/lib/billing/checkout-guard";
import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { useAppShell } from "@/lib/native/use-app-shell";

type Props = { label: string; variant?: "primary" | "secondary" } & (
  | { tier: "creator" | "pro"; interval?: "month" | "year"; pack?: never; pass?: never }
  | { pack: "single" | "three"; tier?: never; interval?: never; pass?: never }
  | { pass: "station"; tier?: never; interval?: never; pack?: never }
);

export function UpgradeButton({ label, variant = "primary", ...target }: Props) {
  const { t } = useUiLang();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const shell = useAppShell();

  function start() {
    setError(null);
    setManageUrl(null);
    // Anonymous daily count of upgrade clicks; no tier, user or session is sent.
    sendFunnelEvent("checkout_started");
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            target.pass
              ? { pass: target.pass }
              : target.pack
                ? { pack: target.pack }
                : { tier: target.tier, interval: target.interval ?? "month" },
          ),
        });
        if (res.status === 401) {
          window.location.assign("/sign-in?next=/pricing");
          return;
        }
        if (!res.ok) {
          const body = (await res
            .json()
            .catch(() => ({}))) as {
            error?: string;
            details?: string;
            manage_url?: string;
          };
          const view = checkoutErrorView(res.status, body);
          setError(view.message || t("pub.upgrade.failed"));
          setManageUrl(view.manageUrl ?? null);
          return;
        }
        const body = (await res.json()) as { url?: string };
        if (!body.url) {
          setError(t("pub.upgrade.noUrl"));
          return;
        }
        window.location.assign(body.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Plain text, no link: store rules forbid steering app users to outside purchase (see lib/native/app-shell.ts).
  if (shell) {
    return <p className="text-xs text-foreground/60">Plans and packs are managed on neo-fm.com with this same account.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className={`block w-full rounded-md border border-accent/40 px-4 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-progress disabled:opacity-60 ${
          variant === "primary" ? "bg-accent/10" : "bg-transparent"
        }`}
      >
        {pending ? t("pub.upgrade.opening") : label}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
      {manageUrl ? (
        <a href={manageUrl} className="text-xs font-medium text-accent hover:underline">
          Manage your plan
        </a>
      ) : null}
    </div>
  );
}

/** Signed-out "Upgrade to X" entry: in the app shell it must not read as a purchase call to action. */
export function UpgradeSignInLink({ label }: { label: string }) {
  const shell = useAppShell();
  if (shell) {
    return <p className="text-xs text-foreground/60">Plans and packs are managed on neo-fm.com with this same account.</p>;
  }
  return (
    <a
      href={`/sign-in?next=${encodeURIComponent("/pricing")}`}
      className="block w-full rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20"
    >
      {label}
    </a>
  );
}
