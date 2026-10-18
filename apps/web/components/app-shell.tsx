/**
 * The authed app shell. Renders the top-nav (desktop), mobile bottom-nav,
 * and wraps the page content with consistent vertical rhythm.
 *
 * Server component: takes pre-resolved `user` props so it can be rendered
 * inside `(app)/layout.tsx`. The interactive bits (user menu popover,
 * theme toggle) are client-side and imported as named exports.
 *
 * The skin tokens (background, foreground, accent, muted) come from
 * `globals.css` and respect the `data-theme` attribute toggled via
 * `<ThemeToggle>`.
 */
import { NotificationBell } from "@/components/notifications/bell";
import Link from "next/link";

import { serverI18n } from "@/lib/i18n/server";
import type { UiKey } from "@/lib/i18n/ui-strings";

import { BrandMark } from "./brand-mark";
import { CommandPalette } from "./command-palette";
import { CommandPaletteTrigger } from "./command-palette-trigger";
import { NavLink } from "./nav-link";
import { IconAccount, IconDiscover, IconLibrary, IconPlus, IconStation } from "./nav-icons";
import { UserMenu } from "./user-menu";
import { WhatsNewLink } from "./whats-new-link";

type NavUser = {
  email: string;
  handle: string | null;
  plan?: string;
};

const TOP_NAV_LINKS: readonly { href: string; label: UiKey }[] = [
  { href: "/station", label: "nav.station" },
  { href: "/library", label: "nav.library" },
  { href: "/discover", label: "nav.discover" },
  { href: "/collections", label: "nav.collections" },
];

type BottomLink = {
  href: string;
  label: UiKey;
  icon: React.ReactNode;
  primary?: boolean;
};

const BOTTOM_NAV_LINKS: readonly BottomLink[] = [
  { href: "/station", label: "nav.station", icon: <IconStation /> },
  { href: "/library", label: "nav.library", icon: <IconLibrary /> },
  { href: "/discover", label: "nav.discover", icon: <IconDiscover /> },
  { href: "/songs/new", label: "nav.create", icon: <IconPlus />, primary: true },
  { href: "/account", label: "nav.account", icon: <IconAccount /> },
];

const TOP_LINK =
  "whitespace-nowrap rounded-full px-3 py-1.5 text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const TOP_LINK_ACTIVE = "bg-foreground/10 text-foreground";

export function AppShell({
  user,
  children,
}: {
  user: NavUser;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen text-foreground">
      <TopNav user={user} />
      <div className="mx-auto w-full max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pb-12 sm:pt-8">
        {children}
      </div>
      <MobileBottomNav />
      <CommandPalette />
    </div>
  );
}

async function TopNav({ user }: { user: NavUser }) {
  const { t } = await serverI18n();
  return (
    <header className="glass sticky top-0 z-30 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <div className="flex items-center gap-6">
          <BrandMark />
          <nav aria-label="Primary" className="hidden items-center gap-0.5 whitespace-nowrap text-sm sm:flex">
            {TOP_NAV_LINKS.map((l) => (
              <NavLink key={l.href} href={l.href} className={TOP_LINK} activeClassName={TOP_LINK_ACTIVE}>
                {t(l.label)}
              </NavLink>
            ))}
            {/* Secondary links wait for room; both stay reachable from the command palette and account menu. */}
            <NavLink href="/insights" className={`${TOP_LINK} hidden lg:inline-block`} activeClassName={TOP_LINK_ACTIVE}>
              Insights
            </NavLink>
            <WhatsNewLink className={`${TOP_LINK} hidden xl:inline-block`} activeClassName={TOP_LINK_ACTIVE} />
          </nav>
        </div>
        <div className="flex flex-none items-center gap-2">
          <CommandPaletteTrigger />
          <NotificationBell />
          <Link
            href="/songs/new"
            className="hidden h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-background shadow-[0_0_24px_-6px_hsl(var(--accent))] transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex"
          >
            {t("nav.newSong")}
          </Link>
          <UserMenu email={user.email} handle={user.handle} plan={user.plan} />
        </div>
      </div>
    </header>
  );
}

async function MobileBottomNav() {
  const { t } = await serverI18n();
  return (
    <nav
      aria-label="Primary mobile"
      className="glass fixed inset-x-0 bottom-0 z-30 rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="mx-auto flex max-w-6xl items-stretch justify-around">
        {BOTTOM_NAV_LINKS.map((l) => {
          if (l.primary) {
            return (
              <li key={l.href} className="flex flex-1 items-center justify-center py-2">
                <Link
                  href={l.href}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-background shadow-[0_0_28px_-4px_hsl(var(--accent))] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={t(l.label)}
                >
                  {l.icon}
                </Link>
              </li>
            );
          }
          return (
            <li key={l.href} className="flex-1">
              <NavLink
                href={l.href}
                className="flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                activeClassName="text-accent"
              >
                {l.icon}
                {t(l.label)}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
