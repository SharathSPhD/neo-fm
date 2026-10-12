"use client";

/** Catch-all boundary for routes outside the (app) and (marketing) groups (auth, public song pages, admin). */
import { ErrorFallback } from "@/components/error-fallback";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="px-6 py-24">
      <ErrorFallback error={error} reset={reset} boundary="root" />
    </div>
  );
}
