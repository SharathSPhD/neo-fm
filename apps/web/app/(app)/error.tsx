"use client";

/**
 * Authed-group error boundary. Renders a friendly error card with the
 * Next.js error digest (used to correlate with server logs) and a
 * "Try again" affordance.
 */
import Link from "next/link";
import { useEffect } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

export default function AppGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useUiLang();
  useEffect(() => {
    // server-side logs already capture this; we just keep the browser log
    // tidy for the user-facing reload.
    console.error("[app] render error", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm">
      <div role="alert">
        <h1 className="text-lg font-semibold text-foreground">
          {t("error.title")}
        </h1>
        <p className="mt-1 text-foreground/70">
          {t("error.body")}{" "}
          <Link
            href="/feedback"
            className="inline-flex min-h-[44px] items-center rounded text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("error.report")}
          </Link>
        </p>
      </div>
      {error.digest && (
        <code className="break-all rounded bg-background/50 px-2 py-1 font-mono text-xs text-foreground/60">
          digest: {error.digest}
        </code>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="min-h-[44px] rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t("error.retry")}
        </button>
        <Link
          href="/library"
          className="inline-flex min-h-[44px] items-center rounded-md border border-muted/40 px-4 py-1.5 text-sm text-foreground/80 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t("error.library")}
        </Link>
      </div>
    </div>
  );
}
