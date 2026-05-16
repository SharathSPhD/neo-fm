"use client";

/**
 * Theme toggle.
 *
 * neo-fm renders dark-by-default (matches the marketing palette in
 * `globals.css`). Users can flip to light via this toggle; choice
 * persists in `localStorage` and is reflected as `data-theme` on
 * `<html>`. The inline boot script in `<AppShell>` reads the same
 * key on first paint to avoid the dreaded flash-of-wrong-theme.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "neo-fm:theme";

function readInitial(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return "dark";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readInitial());
    setMounted(true);
  }, []);

  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private-mode fallback: theme just won't persist.
    }
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={theme === "light"}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-muted/40 text-foreground/70 hover:text-foreground hover:border-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {/* render both, hide the inactive — avoids hydration drift */}
      <span aria-hidden className={mounted && theme === "dark" ? "" : "hidden"}>
        ☾
      </span>
      <span aria-hidden className={mounted && theme === "light" ? "" : "hidden"}>
        ☀
      </span>
      {!mounted && <span aria-hidden>☾</span>}
    </button>
  );
}

/* Persisted theme key. Mirrored by `public/theme-boot.js`, which runs
 * before first paint to avoid a flash-of-wrong-theme on hard reload. */
export const THEME_STORAGE_KEY = STORAGE_KEY;
