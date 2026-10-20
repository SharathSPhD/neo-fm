/**
 * Marketing nav. Auth-aware: when the visitor already has a session,
 * the right side swaps "Sign in / Get started" for a "Library" link and a
 * "Station" button that take them back into the authed app shell.
 *
 * The auth status is read on the server (in `(marketing)/layout.tsx`)
 * and passed in as a boolean prop so this stays a small server-component.
 */
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { serverI18n } from "@/lib/i18n/server";

export async function MarketingNav({
  isSignedIn,
  showSubLinks = true,
}: {
  isSignedIn: boolean;
  showSubLinks?: boolean;
}) {
  const { t } = await serverI18n();
  return (
    <header className="glass sticky top-[env(safe-area-inset-top)] z-30 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-2 gap-y-2 px-3 py-4 min-[400px]:px-4 sm:px-6 sm:py-5">
        <BrandMark label={t("nav.home")} />
        <nav aria-label="Primary" className="flex min-w-0 flex-wrap items-center justify-end gap-0.5 whitespace-nowrap min-[400px]:gap-1 text-sm sm:gap-3">
          {showSubLinks && (
            <>
              <Link
                href="/discover"
                className="hidden rounded-md px-2 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-block sm:px-3"
              >
                {t("nav.discover")}
              </Link>
              <Link
                href="/ideas"
                className="hidden rounded-md px-3 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-block"
              >
                Ideas
              </Link>
              <Link
                href="/pricing"
                className="hidden rounded-md px-2 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-block sm:px-3"
              >
                {t("nav.pricing")}
              </Link>
              <Link
                href="/help"
                className="hidden rounded-md px-3 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-block"
              >
                {t("nav.help")}
              </Link>
            </>
          )}
          <LanguageSwitcher compact />
          {isSignedIn ? (
            <>
              <Link
                href="/library"
                className="rounded-md px-2 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3"
              >
                {t("nav.library")}
              </Link>
              <Link
                href="/station"
                className="whitespace-nowrap rounded-full bg-accent px-4 py-1.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {t("nav.station")}
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="shrink-0 whitespace-nowrap rounded-full px-2 py-1.5 text-foreground/80 sm:border sm:border-muted/40 sm:px-3.5 hover:border-foreground/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t("nav.signIn")}
              </Link>
              <Link
                href="/sign-up"
                className="shrink-0 whitespace-nowrap rounded-full bg-accent px-2.5 py-2.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background min-[400px]:px-4 sm:py-1.5"
              >
                {t("nav.getStarted")}
              </Link>
            </>
          )}
        </nav>
      </div>
      {showSubLinks && (
        // Phones have no room for these beside the sign-up button, so they get their own row.
        <nav aria-label="Secondary" className="mx-auto flex max-w-6xl gap-4 px-4 pb-3 text-sm text-foreground/70 sm:hidden">
          <Link href="/discover" className="inline-flex min-h-8 items-center rounded-md hover:text-foreground">{t("nav.discover")}</Link>
          <Link href="/pricing" className="inline-flex min-h-8 items-center rounded-md hover:text-foreground">{t("nav.pricing")}</Link>
          <Link href="/help" className="inline-flex min-h-8 items-center rounded-md hover:text-foreground">{t("nav.help")}</Link>
        </nav>
      )}
    </header>
  );
}
