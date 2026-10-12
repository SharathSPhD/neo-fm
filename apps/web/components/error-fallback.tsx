"use client";

/**
 * Shared, localized crash fallback used by every route-group error boundary
 * and by global-error. Reports the error once (scrubbed server-side), and
 * shows the Next.js digest so a user can quote it in a support message.
 */
import Link from "next/link";
import { useEffect } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";
import { reportClientError } from "@/lib/obs/report-client-error";

export type ErrorBoundaryKind = "app" | "marketing" | "root" | "global";

export function ErrorFallback({
  error,
  reset,
  boundary,
  homeHref = "/",
  homeKey = "error.home",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  boundary: ErrorBoundaryKind;
  homeHref?: string;
  homeKey?: "error.home" | "error.library";
}) {
  const { t, lang } = useUiLang();
  useEffect(() => {
    reportClientError(error, { boundary, digest: error.digest, lang });
  }, [error, boundary, lang]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm" lang={lang}>
      <div role="alert">
        <h1 className="text-lg font-semibold text-foreground">{t("error.title")}</h1>
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
          {t("error.ref")}: {error.digest}
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
          href={homeHref}
          className="inline-flex min-h-[44px] items-center rounded-md border border-muted/40 px-4 py-1.5 text-sm text-foreground/80 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t(homeKey)}
        </Link>
      </div>
    </div>
  );
}
