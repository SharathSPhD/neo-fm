"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useUiLang } from "@/lib/i18n/use-ui-lang";

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useUiLang();
  useEffect(() => {
    console.error("[marketing] render error", error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-6 py-24 text-sm">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("misc.err.title")}
      </h1>
      <p className="text-foreground/70">
        {t("misc.err.desc")}
      </p>
      {error.digest && (
        <code className="break-all rounded bg-muted/20 px-2 py-1 font-mono text-xs">
          digest: {error.digest}
        </code>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t("error.retry")}
        </button>
        <Link
          href="/"
          className="rounded-md border border-muted/40 px-3 py-1.5 text-foreground/80 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t("misc.err.home")}
        </Link>
      </div>
    </div>
  );
}
