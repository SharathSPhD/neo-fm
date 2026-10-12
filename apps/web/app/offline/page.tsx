/**
 * /offline -- shown by the PWA service worker when a navigation fails
 * with no cached entry. Static page; safe to cache aggressively.
 */
import { T } from "@/components/t";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-medium tracking-tight"><T k="misc.offline.title" /></h1>
      <p className="text-sm text-foreground/60">
        <T k="misc.offline.desc" />
      </p>
      {/* Plain anchor on purpose: a full reload is how the user retries once back online. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent"
      >
        <T k="error.retry" />
      </a>
    </main>
  );
}
