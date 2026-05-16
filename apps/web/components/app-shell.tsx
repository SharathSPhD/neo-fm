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
import Link from "next/link";

import { UserMenu } from "./user-menu";

type NavUser = {
  email: string;
  handle: string | null;
  plan?: string;
};

const TOP_NAV_LINKS = [
  { href: "/library", label: "Library", icon: "▲" },
  { href: "/discover", label: "Discover", icon: "◎" },
] as const;

type BottomLink = {
  href: string;
  label: string;
  icon: string;
  primary?: boolean;
};

const BOTTOM_NAV_LINKS: readonly BottomLink[] = [
  { href: "/library", label: "Library", icon: "♪" },
  { href: "/discover", label: "Discover", icon: "◎" },
  { href: "/songs/new", label: "Create", icon: "+", primary: true },
  { href: "/account", label: "Account", icon: "◐" },
];

export function AppShell({
  user,
  children,
  active,
}: {
  user: NavUser;
  children: React.ReactNode;
  /** Override which nav item is highlighted; defaults to URL-derived. */
  active?: string;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav user={user} active={active} />
      <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pb-12 sm:pt-8">
        {children}
      </div>
      <MobileBottomNav active={active} />
    </div>
  );
}

function TopNav({ user, active }: { user: NavUser; active?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-muted/30 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/library"
            className="text-base font-semibold tracking-tight text-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-lg"
          >
            neo-fm
          </Link>
          <nav
            aria-label="Primary"
            className="hidden items-center gap-1 text-sm sm:flex"
          >
            {TOP_NAV_LINKS.map((l) => {
              const isActive = active ? active === l.href : false;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "rounded-md px-3 py-1.5 text-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    isActive ? "bg-muted/20 text-foreground" : "",
                  ].join(" ")}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/songs/new"
            className="hidden h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-background hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex"
          >
            New song
          </Link>
          <UserMenu
            email={user.email}
            handle={user.handle}
            plan={user.plan}
          />
        </div>
      </div>
    </header>
  );
}

function MobileBottomNav({ active }: { active?: string }) {
  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-muted/30 bg-background/95 backdrop-blur-md sm:hidden"
    >
      <ul className="mx-auto flex max-w-6xl items-stretch justify-around">
        {BOTTOM_NAV_LINKS.map((l) => {
          const isActive = active ? active === l.href : false;
          if (l.primary) {
            return (
              <li key={l.href} className="flex flex-1 items-center justify-center py-2">
                <Link
                  href={l.href}
                  aria-current={isActive ? "page" : undefined}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-2xl font-semibold leading-none text-background shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={l.label}
                >
                  <span aria-hidden>{l.icon}</span>
                </Link>
              </li>
            );
          }
          return (
            <li key={l.href} className="flex-1">
              <Link
                href={l.href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  isActive ? "text-accent" : "text-foreground/65",
                ].join(" ")}
              >
                <span aria-hidden className="text-base">
                  {l.icon}
                </span>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
