"use client";

/**
 * Authed-group error boundary. Renders a friendly error card with the
 * Next.js error digest (used to correlate with server logs) and a
 * "Try again" affordance.
 */
import Link from "next/link";
import { useEffect } from "react";

export default function AppGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // server-side logs already capture this; we just keep the browser log
    // tidy for the user-facing reload.
    console.error("[app] render error", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm">
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          Something broke
        </h1>
        <p className="mt-1 text-foreground/70">
          We hit an unexpected error rendering this page. Reloading often
          clears it. If it persists, share the error digest below with{" "}
          <Link
            href="/feedback"
            className="text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            feedback
          </Link>
          .
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
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Try again
        </button>
        <Link
          href="/library"
          className="rounded-md border border-muted/40 px-3 py-1.5 text-sm text-foreground/80 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Go to library
        </Link>
      </div>
    </div>
  );
}
