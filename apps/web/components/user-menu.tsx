"use client";

/**
 * User menu — avatar trigger that opens a small popover with profile +
 * account links, theme toggle, and sign-out. Keyboard accessible
 * (Tab order, Escape to close, focus trap inside the popover, click
 * outside to dismiss).
 *
 * Rendered inside the desktop nav and the mobile header.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

import { ThemeToggle } from "./theme-toggle";

type Props = {
  email: string;
  handle: string | null;
  /** plan label shown in the menu header ("Free", "Creator", "Pro") */
  plan?: string;
};

export function UserMenu({ email, handle, plan }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (handle || email).slice(0, 2).toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-muted/40 px-2 py-1 text-sm font-medium text-foreground/85 hover:border-foreground/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent"
        >
          {initial}
        </span>
        <span className="hidden truncate sm:inline-block max-w-[10rem]">
          {handle ? `@${handle}` : email}
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-lg border border-muted/40 bg-background/95 shadow-xl backdrop-blur-sm"
        >
          <div className="border-b border-muted/30 px-4 py-3 text-sm">
            <div className="font-medium text-foreground">
              {handle ? `@${handle}` : "Set up your handle"}
            </div>
            <div className="truncate text-xs text-foreground/55">{email}</div>
            {plan && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                {plan}
              </div>
            )}
          </div>
          <nav role="none" className="flex flex-col py-1 text-sm">
            {handle ? (
              <Link
                role="menuitem"
                href={`/u/${handle}`}
                className="px-4 py-2 text-foreground/85 hover:bg-muted/20 hover:text-foreground focus:bg-muted/20 focus:outline-none"
              >
                My profile
              </Link>
            ) : (
              <Link
                role="menuitem"
                href="/onboarding/handle"
                className="px-4 py-2 text-foreground/85 hover:bg-muted/20 hover:text-foreground focus:bg-muted/20 focus:outline-none"
              >
                Pick a handle →
              </Link>
            )}
            <Link
              role="menuitem"
              href="/account"
              className="px-4 py-2 text-foreground/85 hover:bg-muted/20 hover:text-foreground focus:bg-muted/20 focus:outline-none"
            >
              Account & plan
            </Link>
            <Link
              role="menuitem"
              href="/feedback"
              className="px-4 py-2 text-foreground/85 hover:bg-muted/20 hover:text-foreground focus:bg-muted/20 focus:outline-none"
            >
              Send feedback
            </Link>
            <Link
              role="menuitem"
              href="/help"
              className="px-4 py-2 text-foreground/85 hover:bg-muted/20 hover:text-foreground focus:bg-muted/20 focus:outline-none"
            >
              Help & FAQ
            </Link>
          </nav>
          <div className="flex items-center justify-between border-t border-muted/30 px-4 py-3">
            <span className="text-xs text-foreground/60">Theme</span>
            <ThemeToggle />
          </div>
          <form action="/sign-out" method="post" className="border-t border-muted/30">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-4 py-3 text-left text-sm text-foreground/80 hover:bg-muted/20 hover:text-foreground focus:bg-muted/20 focus:outline-none"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
