/**
 * /offline -- shown by the PWA service worker when a navigation fails
 * with no cached entry. Static page; safe to cache aggressively.
 */
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-medium tracking-tight">You&apos;re offline</h1>
      <p className="text-sm text-foreground/60">
        neo-fm needs an internet connection to generate songs.
        Cached songs in your library will still play.
      </p>
      <a
        href="/"
        className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent"
      >
        Try again
      </a>
    </main>
  );
}
