"use client";

/** Authed-group error boundary: localized fallback, scrubbed report, digest for support. */
import { ErrorFallback } from "@/components/error-fallback";

export default function AppGroupError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} boundary="app" homeHref="/library" homeKey="error.library" />;
}
