"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function MarketingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="px-6 py-24">
      <ErrorFallback error={error} reset={reset} boundary="marketing" />
    </div>
  );
}
