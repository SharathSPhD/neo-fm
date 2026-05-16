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

interface Props {
  tier: "creator" | "pro";
  label: string;
}

export function UpgradeButton({ tier, label }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier }),
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
          };
          setError(
            body.details ??
              body.error ??
              "Couldn't start checkout. Try again in a minute.",
          );
          return;
        }
        const body = (await res.json()) as { url?: string };
        if (!body.url) {
          setError("Checkout returned no URL. Try again.");
          return;
        }
        window.location.assign(body.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="block w-full rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-progress disabled:opacity-60"
      >
        {pending ? "Opening checkout…" : label}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
