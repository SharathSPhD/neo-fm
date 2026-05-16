"use client";

/**
 * "Manage subscription" button on /account. Opens a Stripe-hosted
 * Customer Portal session where the user can cancel, change plan,
 * update payment method, or download invoices.
 *
 * - 503 (billing disabled): never rendered, but defensive.
 * - 404 (no customer): show inline copy explaining there's nothing to
 *   manage yet (the UI rendering this normally guards against it via
 *   the server-side billing row check, but env drift between SSR and
 *   click is possible).
 */
import { useState, useTransition } from "react";

export function ManageBillingButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/portal", { method: "POST" });
        if (!res.ok) {
          if (res.status === 404) {
            setError(
              "No Stripe customer is linked yet. Start a checkout from /pricing first.",
            );
            return;
          }
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: string;
          };
          setError(
            body.details ??
              body.error ??
              "Couldn't open the portal. Try again in a minute.",
          );
          return;
        }
        const body = (await res.json()) as { url?: string };
        if (!body.url) {
          setError("Portal returned no URL. Try again.");
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
        onClick={open}
        disabled={pending}
        className="self-start rounded-md border border-muted/40 px-3 py-1.5 text-xs font-medium text-foreground/80 transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent disabled:cursor-progress disabled:opacity-60"
      >
        {pending ? "Opening…" : "Manage subscription"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
