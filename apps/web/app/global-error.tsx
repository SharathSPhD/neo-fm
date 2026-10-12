"use client";

/**
 * Last-resort boundary: replaces the root layout, so it brings its own <html>.
 * Uses the same localized fallback; styles come from globals.css.
 */
import { ErrorFallback } from "@/components/error-fallback";

import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div className="px-6 py-24">
          <ErrorFallback error={error} reset={reset} boundary="global" />
        </div>
      </body>
    </html>
  );
}
