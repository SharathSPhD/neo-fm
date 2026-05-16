/**
 * Marketing nav. Auth-aware: when the visitor already has a session,
 * the right side swaps "Sign in / Get started" for a single "Library"
 * link that takes them back into the authed app shell.
 *
 * The auth status is read on the server (in `(marketing)/layout.tsx`)
 * and passed in as a boolean prop so this stays a small server-component.
 */
import Link from "next/link";

export function MarketingNav({
  isSignedIn,
  showSubLinks = true,
}: {
  isSignedIn: boolean;
  showSubLinks?: boolean;
}) {
  return (
    <header className="border-b border-muted/30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
        <Link
          href="/"
          aria-label="neo-fm home"
          className="text-lg font-semibold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        >
          neo-fm
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm sm:gap-3">
          {showSubLinks && (
            <>
              <Link
                href="/discover"
                className="rounded-md px-2 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3"
              >
                Discover
              </Link>
              <Link
                href="/pricing"
                className="rounded-md px-2 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3"
              >
                Pricing
              </Link>
              <Link
                href="/help"
                className="hidden rounded-md px-3 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-block"
              >
                Help
              </Link>
            </>
          )}
          {isSignedIn ? (
            <Link
              href="/library"
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Library
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="rounded-md border border-muted/40 px-3 py-1.5 text-foreground/80 hover:border-foreground/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
